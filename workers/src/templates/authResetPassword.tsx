/** Ported 1:1 from templates/auth/reset_password.html. */
export function AuthResetPasswordPage(props: { brandName: string; invalid: boolean; error?: string | null }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Reset password · {props.brandName}</title>
        <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=Share+Tech+Mono&display=swap');
    :root { --bg:#0a0a0a; --card:#111; --border:#1e1e1e; --accent:#00f5ff;
            --text:#e0e0e0; --dim:#666; --err:#ff2d78; }
    * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    body { margin:0; background:var(--bg); color:var(--text);
           font:15px/1.55 'Share Tech Mono',monospace;
           min-height:100dvh; display:flex; flex-direction:column;
           align-items:center; justify-content:center;
           padding:24px 16px env(safe-area-inset-bottom); }
    .logo { font-family:'Orbitron',sans-serif; font-size:18px; letter-spacing:2px;
            color:var(--accent); text-decoration:none; margin-bottom:32px;
            text-shadow:0 0 12px rgba(0,245,255,.5); }
    .card { width:100%; max-width:400px; background:var(--card);
            border:1px solid var(--border); border-radius:16px; padding:32px 28px; }
    .corner { position:relative; }
    .corner::before, .corner::after { content:''; position:absolute; width:12px; height:12px;
      border-color:var(--accent); border-style:solid; }
    .corner::before { top:-1px; left:-1px; border-width:2px 0 0 2px; border-radius:4px 0 0 0; }
    .corner::after  { bottom:-1px; right:-1px; border-width:0 2px 2px 0; border-radius:0 0 4px 0; }
    h1 { font-family:'Orbitron',sans-serif; font-size:20px; margin:0 0 6px;
         color:#fff; letter-spacing:1px; }
    .sub { color:var(--dim); font-size:13px; margin:0 0 24px; }
    label { display:block; font-size:12px; color:var(--dim); letter-spacing:1px;
            text-transform:uppercase; margin-bottom:6px; }
    input { display:block; width:100%; padding:12px 14px; background:#0a0a0a;
            border:1px solid var(--border); border-radius:8px; color:#fff;
            font:15px 'Share Tech Mono',monospace; outline:none; margin-bottom:16px; }
    input:focus { border-color:var(--accent); box-shadow:0 0 0 2px rgba(0,245,255,.1); }
    .err { background:rgba(255,45,120,.1); border:1px solid rgba(255,45,120,.3);
           border-radius:8px; padding:10px 14px; color:var(--err);
           font-size:13px; margin-bottom:16px; }
    .invalid-box { color:var(--err); font-size:14px; }
    .invalid-box a { color:var(--accent); }
    .btn { display:block; width:100%; padding:14px; background:var(--accent);
           color:#000; font-family:'Orbitron',sans-serif; font-size:13px;
           letter-spacing:1px; font-weight:700; border:none; border-radius:8px;
           cursor:pointer; text-align:center; text-decoration:none;
           text-transform:uppercase; transition:opacity .15s; }
    .btn:hover { opacity:.85; }
    .links { margin-top:20px; text-align:center; font-size:13px; color:var(--dim); }
    .links a { color:var(--accent); text-decoration:none; }
        `}</style>
      </head>
      <body>
        <a class="logo" href="/">
          {props.brandName}
        </a>
        <div class="card corner">
          <h1>Reset password</h1>
          {props.invalid ? (
            <p class="invalid-box">
              This reset link is invalid or has expired.
              <br />
              <br />
              <a href="/auth/forgot-password">Request a new one →</a>
            </p>
          ) : (
            <>
              <p class="sub">Choose a new password for your account.</p>
              {props.error ? <div class="err">{props.error}</div> : null}
              <form method="post">
                <label>New password</label>
                <input
                  type="password"
                  name="password"
                  autocomplete="new-password"
                  required
                  minlength={8}
                  placeholder="8+ characters"
                  autofocus
                />
                <label>Confirm password</label>
                <input type="password" name="confirm" autocomplete="new-password" required minlength={8} />
                <button class="btn" type="submit">
                  Set new password
                </button>
              </form>
            </>
          )}
          <div class="links">
            <a href="/auth/login">Back to sign in</a>
          </div>
        </div>
      </body>
    </html>
  );
}
