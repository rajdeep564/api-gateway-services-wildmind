import React, { useEffect, useState } from 'react';
import './app.css';
import { auth, googleProvider, db } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

type ClientUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

export default function App() {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [saved, setSaved] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [phase, setPhase] = useState<'auth' | 'email-password' | 'otp' | 'username' | 'done'>('auth');
  const [otp, setOtp] = useState('');
  const [otpTtl, setOtpTtl] = useState<number>(0);
  const [otpCountdown, setOtpCountdown] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [lastUser, setLastUser] = useState<{ email: string; photoURL?: string; displayName?: string; provider: string } | null>(null);
  // Username will be collected AFTER authentication

  // Simple client-side routing via History API
  function setPath(path: string, replace = false) {
    if (location.pathname === path) return;
    if (replace) {
      history.replaceState({}, '', path);
    } else {
      history.pushState({}, '', path);
    }
  }

  useEffect(() => {
    // Load last user from localStorage
    const stored = localStorage.getItem('lastUser');
    if (stored) {
      try {
        setLastUser(JSON.parse(stored));
      } catch {}
    }

    // Initialize from URL path
    const p = location.pathname;
    if (p.startsWith('/sign-in')) {
      setMode('signin');
      setPhase('auth');
    } else if (p.startsWith('/sign-up/otp')) {
      setMode('signup');
      setPhase('otp');
    } else if (p.startsWith('/sign-up/username')) {
      setMode('signup');
      setPhase('username');
    } else if (p.startsWith('/sign-up')) {
      setMode('signup');
      setPhase('auth');
    }

    // Back/forward handling
    const onPop = () => {
      const pp = location.pathname;
      if (pp.startsWith('/sign-in')) { setMode('signin'); setPhase('auth'); }
      else if (pp.startsWith('/sign-up/otp')) { setMode('signup'); setPhase('otp'); }
      else if (pp.startsWith('/sign-up/username')) { setMode('signup'); setPhase('username'); }
      else if (pp.startsWith('/sign-up')) { setMode('signup'); setPhase('auth'); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Keep URL in sync with phase/mode
  useEffect(() => {
    if (phase === 'auth') setPath(mode === 'signup' ? '/sign-up' : '/sign-in', true);
    else if (phase === 'otp') setPath('/sign-up/otp');
    else if (phase === 'username') setPath('/sign-up/username');
  }, [phase, mode]);

  useEffect(() => {
    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setUsername('');
        setSaved(false);
        if (phase !== 'auth') setPhase('auth');
      } else {
        setUser({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
          photoURL: fbUser.photoURL
        });
        // Load current username if exists
        try {
          const ref = doc(db, 'users', fbUser.uid);
          const snap = await getDoc(ref);
          const data = snap.data() as any;
        if (data?.username) {
          setUsername(data.username);
          setPhase('done');
          setPath(`/user/${fbUser.uid}/${encodeURIComponent(data.username)}`, true);
        } else {
          setPhase('username');
          setPath('/sign-up/username', true);
        }
        // Store last logged in user info
        const lastUserInfo = {
          email: fbUser.email || '',
          photoURL: fbUser.photoURL,
          displayName: fbUser.displayName,
          provider: data?.provider || 'unknown'
        };
        setLastUser(lastUserInfo);
        localStorage.setItem('lastUser', JSON.stringify(lastUserInfo));
        } catch {}
      }
    });
  }, []);

  async function handleGoogle() {
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const u = cred.user;
      setEmail(u.email || '');
      const ref = doc(db, 'users', u.uid);
      const snap = await getDoc(ref);
      
      // Check if user exists and has different provider
      if (snap.exists()) {
        const data = snap.data() as any;
        if (data?.provider === 'password') {
          setError('You already signed up with Email/Password. Please use "Continue with Email/Password" instead.');
          return;
        }
        await updateDoc(ref, { lastLoginAt: serverTimestamp() });
        if (data?.username) setUsername(data.username);
      } else {
        await setDoc(ref, {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          provider: 'google',
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp()
        });
      }
      
      // Go directly to username for Google users
      setPhase('username');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function upsertEmailUser(uid: string, emailValue: string | null) {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        email: emailValue,
        displayName: null,
        photoURL: null,
        provider: 'password',
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      });
    } else {
      await updateDoc(ref, { lastLoginAt: serverTimestamp() });
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signup') {
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }
        // Start OTP flow via backend
        const resp = await fetch('/api/auth/email/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        if (!resp.ok) {
          const msg = await resp.text();
          throw new Error(msg || 'Failed to start OTP');
        }
        const j = await resp.json();
        const ttl = Number(j.data?.ttl ?? 60);
        setOtpTtl(ttl);
        setOtpCountdown(ttl);
        setPhase('otp');
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await upsertEmailUser(cred.user.uid, cred.user.email);
      }
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === 'auth/email-already-in-use') {
        setError('Email already in use. Please sign in instead.');
        setMode('signin');
      } else if (code === 'auth/invalid-credential' || code === 'auth/user-not-found') {
        setError('No account found or wrong password. Try signing up.');
        setMode('signup');
      } else if (code === 'auth/invalid-email') {
        setError('Invalid email address.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Please try again later.');
      } else {
        setError(err?.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (!/^[0-9]{6}$/.test(otp)) {
        throw new Error('Enter a 6-digit code');
      }
      // Verify OTP - send password only if we have one (email/password flow)
      const resp = await fetch('/api/auth/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp, password: password || '' })
      });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'OTP verification failed');
      }
      setPhase('username');
    } catch (err: any) {
      setError(err?.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  }

  // OTP countdown timer
  useEffect(() => {
    if (phase !== 'otp' || otpCountdown <= 0) return;
    const t = setInterval(() => setOtpCountdown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [phase, otpCountdown]);

  async function handleResendOtp() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/auth/email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!resp.ok) throw new Error('Failed to resend OTP');
      const j = await resp.json();
      const ttl = Number(j.data?.ttl ?? 60);
      setOtp('');
      setOtpTtl(ttl);
      setOtpCountdown(ttl);
    } catch (e: any) {
      setError(e?.message || 'Failed to resend OTP');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetUsername(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const targetEmail = email || auth.currentUser?.email || '';
      const resp = await fetch('/api/auth/email/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, username })
      });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Failed to set username');
      }
      // If user is already signed in (e.g., Google), just finish and set pretty URL /user/:uid/:username
      if (auth.currentUser) {
        setSaved(true);
        const uid = auth.currentUser.uid;
        const uname = username;
        setPhase('done');
        if (uid && uname) setPath(`/user/${uid}/${encodeURIComponent(uname)}`);
      } else {
        // auto sign-in after username set (email/password)
        try {
          await signInWithEmailAndPassword(auth, email, password);
          setSaved(true);
          const uid = auth.currentUser?.uid || '';
          const uname = username;
          setPhase('done');
          if (uid && uname) setPath(`/user/${uid}/${encodeURIComponent(uname)}`);
        } catch (e: any) {
          setError('Account created. Please sign in with your email and password.');
          setMode('signin');
          setPhase('auth');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to set username');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveUsername() {
    if (!user) return;
    setLoading(true);
    setSaved(false);
    try {
      const ref = doc(db, 'users', user.uid);
      await setDoc(ref, { username }, { merge: true });
      setSaved(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setUser(null);
    setEmail('');
    setPassword('');
    setUsername('');
    setOtp('');
    setError(null);
    setSaved(false);
    setPhase('auth');
    setMode('signin');
  }

  return (
    <div className="app-root">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 className="title" style={{ margin: 0 }}>{mode === 'signup' ? 'Create an account' : 'Log in'}</h3>
          {(!user && phase === 'auth') ? (
            <div className="tabs">
              <button className={`tab ${mode === 'signin' ? 'active' : ''}`} type="button" onClick={() => setMode('signin')}>Log In</button>
              <button className={`tab ${mode === 'signup' ? 'active' : ''}`} type="button" onClick={() => setMode('signup')}>Sign Up</button>
            </div>
          ) : null}
        </div>
        {phase === 'done' ? (
          <div className="stack">
            <div className="success">Login successful</div>
            <button className="btn secondary" type="button" onClick={handleLogout}>Logout</button>
          </div>
        ) : phase === 'username' ? (
          <form onSubmit={handleSetUsername} className="stack">
            <input className="input" placeholder="Choose a username (a-z0-9_.-)" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <button className="btn" type="submit" disabled={loading}>Save username</button>
            {error ? <div className="error">{error}</div> : null}
          </form>
        ) : phase === 'email-password' ? (
          <form onSubmit={handleEmailAuth} className="stack">
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn" type="submit" disabled={loading}>Continue</button>
            {error ? <div className="error">{error}</div> : null}
          </form>
        ) : phase === 'otp' ? (
          <form onSubmit={handleVerifyOtp} className="stack">
            <input
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="Enter 6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn" type="submit" disabled={loading}>Verify OTP</button>
              <button className="btn secondary" type="button" onClick={handleResendOtp} disabled={loading || otpCountdown > 0}>
                {otpCountdown > 0 ? `Resend in ${otpCountdown}s` : 'Resend OTP'}
              </button>
            </div>
            {error ? <div className="error">{error}</div> : null}
          </form>
        ) : !user ? (
          <div className="stack">
            {lastUser && phase === 'auth' && mode === 'signin' ? (
              <div className="stack" style={{ marginBottom: 16 }}>
                <div style={{ textAlign: 'center', marginBottom: 12 }}>Welcome back!</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #374151', borderRadius: 8 }}>
                  {lastUser.photoURL ? (
                    <img src={lastUser.photoURL} width={40} height={40} style={{ borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
                      {(lastUser.displayName || lastUser.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div>{lastUser.displayName || lastUser.email}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>Continue as {lastUser.displayName || lastUser.email}</div>
                  </div>
                </div>
                <button type="button" className="link" onClick={() => setLastUser(null)}>Not you? Use another account</button>
              </div>
            ) : null}
            
            <button className="btn" onClick={handleGoogle} disabled={loading}>Continue with Google</button>
            <button className="btn secondary" onClick={() => setPhase('email-password')} disabled={loading}>Continue with Email/Password</button>
            
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              {mode === 'signup' ? (
                <button type="button" className="link" onClick={() => setMode('signin')}>Already have an account? Log in</button>
              ) : (
                <button type="button" className="link" onClick={() => setMode('signup')}>Don't have an account? Sign up</button>
              )}
            </div>
            {error ? <div className="error">{error}</div> : null}
          </div>
        ) : (
          <div className="stack">
            <div className="muted">Signed in</div>
            <div className="row">
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Update username" />
              <button className="btn ghost" onClick={handleSaveUsername} disabled={loading}>Save</button>
            </div>
            {saved ? <div className="success">Saved</div> : null}
            <button className="btn secondary" type="button" onClick={handleLogout}>Logout</button>
          </div>
        )}
      </div>
    </div>
  );
}


