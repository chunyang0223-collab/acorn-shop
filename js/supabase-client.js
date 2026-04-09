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
        is(col, val)   { _filters.push(col + '=is.' + val); return q; },
        or(expr)       { _filters.push('or=(' + expr + ')'); return q; },
        filter(col, op, val) { _filters.push(col + '=' + op + '.' + encodeURIComponent(val)); return q; },
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
          let _retried = false;
          try {
            let finalUrl = _url;
            // .select()가 명시적으로 호출되었는지 추적
            const hasExplicitSelect = finalUrl.includes('?select=');
            // PATCH/DELETE에서 .select()가 호출되지 않았으면 select 파라미터 생략 (RLS 400 방지)
            if (!hasExplicitSelect) {
              if (_method !== 'PATCH' && _method !== 'DELETE') {
                finalUrl += '?select=' + _select;
              } else {
                if (!finalUrl.includes('?')) finalUrl += '?';
              }
            }
            if (_filters.length) finalUrl += (finalUrl.endsWith('?') ? '' : '&') + _filters.join('&');
            if (_order) finalUrl += '&order=' + _order;

            const h = { ...headers };
            if (_upsert) { h['Prefer'] = 'resolution=merge-duplicates,return=representation'; if (_upsertConflict) { const u = new URL(finalUrl); u.searchParams.set('on_conflict', _upsertConflict); finalUrl = u.toString(); } }
            else if (_method === 'POST') h['Prefer'] = 'return=representation';
            // PATCH/DELETE + .select() 호출 시 return=representation 추가
            else if ((_method === 'PATCH' || _method === 'DELETE') && hasExplicitSelect) h['Prefer'] = 'return=representation';
            if (_countExact) h['Prefer'] = (h['Prefer'] ? h['Prefer'] + ',' : '') + 'count=exact';
            // maybeSingle: Accept 헤더 없이 배열로 받아서 첫 번째 요소 반환 (406 방지)
            if (_single) h['Accept'] = 'application/vnd.pgrst.object+json';
            if (_maybeSingle && !finalUrl.includes('limit=1')) { finalUrl += (finalUrl.endsWith('?') ? '' : '&') + 'limit=1'; }

            const r = await fetch(finalUrl, { method: _method, headers: h, body: _body });
            const text = await r.text();
            let d = null;
            try { d = text ? JSON.parse(text) : null; } catch(e) { d = null; }

            // Content-Range 헤더에서 count 파싱
            let count = null;
            const cr = r.headers?.get?.('Content-Range');
            if (cr) { const m = cr.match(/\/(\d+)/); if (m) count = parseInt(m[1]); }

            // 401 → 토큰 만료 가능성 → 자동 갱신 후 재시도 (1회)
            if (r.status === 401 && _session?.refresh_token && !_retried) {
              console.log('[supabase-client] 401 감지, 토큰 갱신 후 재시도');
              _retried = true;
              await _refreshSession();
              // 갱신된 헤더로 재요청
              const h2 = { ...h, 'Authorization': headers['Authorization'] };
              const r2 = await fetch(finalUrl, { method: _method, headers: h2, body: _body });
              const text2 = await r2.text();
              let d2 = null;
              try { d2 = text2 ? JSON.parse(text2) : null; } catch(e) { d2 = null; }
              let count2 = null;
              const cr2 = r2.headers?.get?.('Content-Range');
              if (cr2) { const m = cr2.match(/\/(\d+)/); if (m) count2 = parseInt(m[1]); }
              if (!r2.ok) {
                resolve({ data: null, error: { message: d2?.message || d2?.hint || r2.statusText }, count: count2 });
              } else {
                if (_maybeSingle && Array.isArray(d2)) d2 = d2.length > 0 ? d2[0] : null;
                resolve({ data: d2, error: null, count: count2 });
              }
              return;
            }
            if (!r.ok) {
              resolve({ data: null, error: { message: d?.message || d?.hint || r.statusText }, count });
            } else {
              // maybeSingle: 배열에서 첫 번째 요소 추출, 없으면 null
              if (_maybeSingle && Array.isArray(d)) {
                d = d.length > 0 ? d[0] : null;
              }
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
        const text = await r.text();
        const d = text ? JSON.parse(text) : null;
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
