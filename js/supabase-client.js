const supabase = (() => {
  function createClient(url, key) {
    const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
    let _session = null;
    let _listeners = [];
    let _refreshTimer = null;

    function _notify(event, session) {
      _listeners.forEach(fn => fn(event, session));
    }

    function _saveSession(s) {
      _session = s;
      if (s) {
        localStorage.setItem('sb_session', JSON.stringify(s));
        // 자동 토큰 갱신
        const exp = s.expires_at * 1000 - Date.now() - 60000;
        if (_refreshTimer) clearTimeout(_refreshTimer);
        if (exp > 0) _refreshTimer = setTimeout(_refreshSession, exp);
      } else {
        localStorage.removeItem('sb_session');
      }
    }

    async function _refreshSession() {
      const s = _session;
      if (!s?.refresh_token) return;
      try {
        const r = await fetch(url + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers,
          body: JSON.stringify({ refresh_token: s.refresh_token })
        });
        const d = await r.json();
        if (d.access_token) {
          const ns = { ...d, user: d.user || s.user };
          _saveSession(ns);
          headers['Authorization'] = 'Bearer ' + d.access_token;
          _notify('TOKEN_REFRESHED', ns);
        }
      } catch(e) {}
    }

    const auth = {
      async getSession() {
        if (_session) return { data: { session: _session } };
        const stored = localStorage.getItem('sb_session');
        if (stored) {
          try {
            const s = JSON.parse(stored);
            if (s.expires_at && s.expires_at * 1000 > Date.now()) {
              _session = s;
              headers['Authorization'] = 'Bearer ' + s.access_token;
              return { data: { session: s } };
            }
          } catch(e) {}
        }
        return { data: { session: null } };
      },

      onAuthStateChange(fn) {
        _listeners.push(fn);
        return { data: { subscription: { unsubscribe: () => { _listeners = _listeners.filter(f => f !== fn); } } } };
      },

      async signUp({ email, password, options }) {
        const r = await fetch(url + '/auth/v1/signup', {
          method: 'POST', headers,
          body: JSON.stringify({ email, password, data: options?.data || {} })
        });
        const d = await r.json();
        if (d.error || d.msg) return { error: { message: d.error_description || d.msg || d.error } };
        if (d.access_token) {
          const s = { ...d, user: d.user };
          _saveSession(s);
          headers['Authorization'] = 'Bearer ' + d.access_token;
          _notify('SIGNED_IN', s);
        }
        return { data: d, error: null };
      },

      async signInWithPassword({ email, password }) {
        const r = await fetch(url + '/auth/v1/token?grant_type=password', {
          method: 'POST', headers,
          body: JSON.stringify({ email, password })
        });
        const d = await r.json();
        if (!r.ok) return { error: { message: d.error_description || d.msg || '로그인 실패' } };
        const s = { ...d, user: d.user };
        _saveSession(s);
        headers['Authorization'] = 'Bearer ' + d.access_token;
        _notify('SIGNED_IN', s);
        return { data: { session: s }, error: null };
      },

      async signInWithOAuth({ provider, options }) {
        const redirectTo = encodeURIComponent(options?.redirectTo || window.location.href);
        window.location.href = url + '/auth/v1/authorize?provider=' + provider + '&redirect_to=' + redirectTo;
        return { error: null };
      },

      async signOut() {
        try {
          await fetch(url + '/auth/v1/logout', { method: 'POST', headers });
        } catch(e) {}
        _saveSession(null);
        headers['Authorization'] = 'Bearer ' + key;
        _notify('SIGNED_OUT', null);
      },

      async getUser() {
        if (!_session) return { data: { user: null } };
        return { data: { user: _session.user } };
      }
    };

    function from(table) {
      let _url = url + '/rest/v1/' + table;
      let _method = 'GET';
      let _body = null;
      let _filters = [];
      let _select = '*';
      let _order = null;
      let _single = false;
      let _maybeSingle = false;
      let _upsert = false;
      let _upsertConflict = null;
      let _countExact = false;

      const q = {
        select(cols, opts) {
          _select = cols || '*';
          _url = url + '/rest/v1/' + table + '?select=' + _select;
          if (opts?.count === 'exact') _countExact = true;
          return q;
        },
        eq(col, val)   { _filters.push(col + '=eq.'   + encodeURIComponent(val)); return q; },
        in(col, vals)  { _filters.push(col + '=in.(' + vals.map(v => encodeURIComponent(v)).join(',') + ')'); return q; },
        neq(col, val)  { _filters.push(col + '=neq.'  + encodeURIComponent(val)); return q; },
        ilike(col, val){ _filters.push(col + '=ilike.' + encodeURIComponent(val)); return q; },
        gte(col, val)  { _filters.push(col + '=gte.'  + encodeURIComponent(val)); return q; },
        lte(col, val)  { _filters.push(col + '=lte.'  + encodeURIComponent(val)); return q; },
        gt(col, val)   { _filters.push(col + '=gt.'   + encodeURIComponent(val)); return q; },
        lt(col, val)   { _filters.push(col + '=lt.'   + encodeURIComponent(val)); return q; },
        order(col, opts){ _order = col + (opts?.ascending === false ? '.desc' : '.asc'); return q; },
        limit(n)       { _filters.push('limit=' + n); return q; },
        range(from, to){ _filters.push('limit=' + (to - from + 1)); _filters.push('offset=' + from); return q; },
        single()       { _single = true; return q; },
        maybeSingle()  { _maybeSingle = true; return q; },
        insert(data)   { _method = 'POST'; _body = JSON.stringify(data); return q; },
        upsert(data, opts) { _method = 'POST'; _body = JSON.stringify(data); _upsert = true; if (opts?.onConflict) _upsertConflict = opts.onConflict; return q; },
        update(data)   { _method = 'PATCH'; _body = JSON.stringify(data); return q; },
        delete()       { _method = 'DELETE'; return q; },

        async then(resolve, reject) {
          try {
            let finalUrl = _url;
            if (!finalUrl.includes('?')) finalUrl += '?select=' + _select;
            if (_filters.length) finalUrl += '&' + _filters.join('&');
            if (_order) finalUrl += '&order=' + _order;

            const h = { ...headers };
            if (_upsert) { h['Prefer'] = 'resolution=merge-duplicates,return=representation'; if (_upsertConflict) { const u = new URL(finalUrl); u.searchParams.set('on_conflict', _upsertConflict); finalUrl = u.toString(); } }
            else if (_method === 'POST' || _method === 'PATCH') h['Prefer'] = 'return=representation';
            if (_countExact) h['Prefer'] = (h['Prefer'] ? h['Prefer'] + ',' : '') + 'count=exact';
            if (_single || _maybeSingle) h['Accept'] = 'application/vnd.pgrst.object+json';

            const r = await fetch(finalUrl, { method: _method, headers: h, body: _body });
            const text = await r.text();
            let d = null;
            try { d = text ? JSON.parse(text) : null; } catch(e) { d = null; }

            // Content-Range 헤더에서 count 파싱
            let count = null;
            const cr = r.headers?.get?.('Content-Range');
            if (cr) { const m = cr.match(/\/(\d+)/); if (m) count = parseInt(m[1]); }

            if (!r.ok) {
              // maybeSingle: 406(결과없음)은 에러 아님 → data:null, error:null
              if (_maybeSingle && (r.status === 406 || r.status === 404)) {
                resolve({ data: null, error: null, count });
              } else {
                resolve({ data: null, error: { message: d?.message || d?.hint || r.statusText }, count });
              }
            } else {
              resolve({ data: d, error: null, count });
            }
          } catch(e) {
            resolve({ data: null, error: { message: e.message }, count: null });
          }
        }
      };
      return q;
    }

    async function rpc(fn, params) {
      const h = { ...headers, 'Prefer': 'return=representation' };
      try {
        const r = await fetch(url + '/rest/v1/rpc/' + fn, {
          method: 'POST', headers: h,
          body: JSON.stringify(params)
        });
        const d = await r.json();
        if (!r.ok) return { data: null, error: { message: d?.message || d?.hint || 'RPC 오류' } };
        return { data: d, error: null };
      } catch(e) {
        return { data: null, error: { message: e.message } };
      }
    }

    function channel(name) {
      // Realtime은 WebSocket 필요 - 폴링으로 대체 (간단 구현)
      return {
        on(event, filter, cb) { return this; },
        subscribe() { return this; }
      };
    }

    return { auth, from, rpc, channel };
  }
  return { createClient };
})();
