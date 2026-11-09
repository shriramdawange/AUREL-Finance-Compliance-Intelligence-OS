import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { ArrowRight, Building2, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type Organization = { id: string; name: string; slug: string };
type Membership = { organization_id: string; role: string; organization: Organization };

type AurelSessionContextValue = {
  mode: "demo" | "live";
  client: typeof supabase;
  user: User | null;
  userId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  isAuthenticated: boolean;
};

const demoContext: AurelSessionContextValue = {
  mode: "demo",
  client: null,
  user: null,
  userId: null,
  organizationId: null,
  organizationName: null,
  isAuthenticated: false,
};

const AurelSessionContext = createContext<AurelSessionContextValue>(demoContext);

export function useAurelSession() {
  return useContext(AurelSessionContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured || !supabase) {
    return <AurelSessionContext.Provider value={demoContext}>{children}</AurelSessionContext.Provider>;
  }
  return <ConfiguredAuthGate>{children}</ConfiguredAuthGate>;
}

function ConfiguredAuthGate({ children }: { children: ReactNode }) {
  const client = supabase!;
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setChecking(false);
    });
    const { data: authListener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setMemberships([]);
      setOrganizationId("");
      setError("");
      setMessage("");
    });
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!session?.user) {
      setMemberships([]);
      setOrganizationId("");
      setMembershipLoading(false);
      return;
    }
    let mounted = true;
    setMembershipLoading(true);
    client
      .from("organization_members")
      .select("organization_id, role, organizations(id, name, slug)")
      .eq("user_id", session.user.id)
      .eq("member_status", "active")
      .then(({ data, error: membershipError }) => {
        if (!mounted) return;
        if (membershipError) {
          setError("Workspace setup is not applied to this Supabase project yet. Apply supabase/bootstrap.sql first. " + membershipError.message);
          setMemberships([]);
        } else {
          const rows = (data ?? []).map((row: any) => {
            const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
            return organization ? { organization_id: row.organization_id, role: row.role, organization } as Membership : null;
          }).filter(Boolean) as Membership[];
          setMemberships(rows);
          if (rows.length === 1) setOrganizationId(rows[0].organization_id);
          else if (rows.length > 1 && !rows.some((row) => row.organization_id === organizationId)) {
            const saved = localStorage.getItem("aurel.activeOrganizationId");
            setOrganizationId(rows.some((row) => row.organization_id === saved) ? saved! : "");
          }
        }
        setMembershipLoading(false);
      });
    return () => { mounted = false; };
  }, [client, session?.user?.id]);

  const activeMembership = memberships.find((item) => item.organization_id === organizationId) ?? null;
  const contextValue = useMemo<AurelSessionContextValue>(() => ({
    mode: "live",
    client,
    user: session?.user ?? null,
    userId: session?.user?.id ?? null,
    organizationId: activeMembership?.organization_id ?? null,
    organizationName: activeMembership?.organization.name ?? null,
    isAuthenticated: Boolean(session?.user && activeMembership),
  }), [client, session?.user, activeMembership]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (authMode === "signup") {
        const { data, error: signUpError } = await client.auth.signUp({ email: email.trim(), password });
        if (signUpError) throw signUpError;
        if (data.session) setMessage("Account created. Your secure session is starting.");
        else setMessage("Account created. Check your email to confirm the address, then sign in.");
      } else {
        const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
        setMessage("Signed in. Loading your organisation workspace…");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user) return;
    setBusy(true);
    setError("");
    try {
      const name = organizationName.trim();
      const slugBase = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      const slug = (slugBase || "aurel-workspace") + "-" + crypto.randomUUID().slice(0, 6);
      const { data: organization, error: organizationError } = await client
        .from("organizations")
        .insert({ name, slug, created_by: session.user.id })
        .select("id, name, slug")
        .single();
      if (organizationError) throw organizationError;
      const { error: membershipError } = await client.from("organization_members").insert({
        organization_id: organization.id,
        user_id: session.user.id,
        role: "owner",
      });
      if (membershipError) throw membershipError;
      const membership = { organization_id: organization.id, role: "owner", organization } as Membership;
      setMemberships([membership]);
      setOrganizationId(organization.id);
      localStorage.setItem("aurel.activeOrganizationId", organization.id);
      setMessage("Workspace created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the workspace.");
    } finally {
      setBusy(false);
    }
  };

  if (checking || membershipLoading) {
    return <div className="auth-loading"><LoaderCircle className="spin" size={24}/><span>Securing your AUREL workspace…</span></div>;
  }

  if (!session?.user) {
    return (
      <div className="auth-page">
        <div className="auth-brand"><div className="auth-brand-mark">A</div><div><b>AUREL</b><span>FINANCE INTELLIGENCE</span></div></div>
        <section className="auth-card">
          <div className="auth-card-icon"><LockKeyhole size={19}/></div>
          <div className="eyebrow">SECURE WORKSPACE ACCESS</div>
          <h1>{authMode === "signin" ? "Welcome back." : "Create your account."}</h1>
          <p>Sign in to access your organisation's finance and compliance workspace.</p>
          <form onSubmit={submitAuth} className="auth-form">
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com"/></label>
            <label>Password<input type="password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters"/></label>
            {error && <div className="auth-alert error">{error}</div>}
            {message && <div className="auth-alert success">{message}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : null}{authMode === "signin" ? "Sign in securely" : "Create account"}<ArrowRight size={15}/></button>
          </form>
          <div className="auth-switch">{authMode === "signin" ? "New to AUREL?" : "Already have an account?"}<button onClick={() => {setAuthMode(authMode === "signin" ? "signup" : "signin");setError("");setMessage("");}}>{authMode === "signin" ? "Create an account" : "Sign in"}</button></div>
          <div className="auth-security"><ShieldCheck size={14}/> Authentication and organisation membership are enforced by Supabase Auth + database RLS.</div>
        </section>
        <div className="auth-footer">AUREL · Finance & Compliance Intelligence OS</div>
      </div>
    );
  }

  if (memberships.length === 0) {
    return (
      <div className="auth-page">
        <div className="auth-brand"><div className="auth-brand-mark">A</div><div><b>AUREL</b><span>FINANCE INTELLIGENCE</span></div></div>
        <section className="auth-card">
          <div className="auth-card-icon"><Building2 size={19}/></div>
          <div className="eyebrow">FIRST-TIME WORKSPACE SETUP</div>
          <h1>Set up your organisation.</h1>
          <p>Create the first workspace. You will become its owner. Invite team members later through the controlled membership workflow.</p>
          <form onSubmit={createOrganization} className="auth-form">
            <label>Organisation name<input required minLength={2} maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="e.g. GenSolutions Finance"/></label>
            {error && <div className="auth-alert error">{error}</div>}
            {message && <div className="auth-alert success">{message}</div>}
            <button className="auth-submit" type="submit" disabled={busy || !organizationName.trim()}>{busy ? <LoaderCircle className="spin" size={16}/> : null}Create organisation<ArrowRight size={15}/></button>
          </form>
          <button className="auth-signout" onClick={() => client.auth.signOut()}>Sign out</button>
        </section>
      </div>
    );
  }

  if (!activeMembership) {
    return (
      <div className="auth-page">
        <div className="auth-brand"><div className="auth-brand-mark">A</div><div><b>AUREL</b><span>FINANCE INTELLIGENCE</span></div></div>
        <section className="auth-card">
          <div className="auth-card-icon"><Building2 size={19}/></div>
          <div className="eyebrow">SELECT WORKSPACE</div>
          <h1>Where are we working?</h1>
          <p>Your account belongs to more than one organisation. Choose the workspace to open.</p>
          <div className="workspace-choices">{memberships.map((membership) => <button key={membership.organization_id} onClick={() => {setOrganizationId(membership.organization_id);localStorage.setItem("aurel.activeOrganizationId",membership.organization_id);}}><span className="workspace-choice-mark">{membership.organization.name.charAt(0)}</span><span><b>{membership.organization.name}</b><small>{membership.role.replace("_"," ")}</small></span><ArrowRight size={15}/></button>)}</div>
          <button className="auth-signout" onClick={() => client.auth.signOut()}>Sign out</button>
        </section>
      </div>
    );
  }

  return (
    <AurelSessionContext.Provider value={contextValue}>
      <div className="aurel-live-session">
        <div className="live-session-label"><span/> SECURE SESSION</div>
        <b>{activeMembership.organization.name}</b>
        <span className="live-session-notice">Authentication & organisation isolation enabled · accounting, tax and analytics modules still use prototype data until their services are wired.</span>
        <button onClick={() => client.auth.signOut()}>Sign out</button>
      </div>
      {children}
    </AurelSessionContext.Provider>
  );
}
