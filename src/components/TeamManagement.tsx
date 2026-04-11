import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  UserPlus, Shield, Trash2, Loader2, Mail, Clock, Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { type AppRole, ROLE_LABELS, ROLE_DESCRIPTIONS, useUserRole } from "@/hooks/use-user-role";

interface TeamMember {
  id: string;
  user_id: string;
  role: AppRole;
  email?: string;
  created_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: AppRole;
  status: string;
  created_at: string;
}

export default function TeamManagement() {
  const { isAdmin } = useUserRole();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("viewer");
  const [sending, setSending] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const { data: roles } = await supabase
      .from("user_roles")
      .select("*")
      .order("created_at");

    setMembers((roles || []).map(r => ({
      id: r.id,
      user_id: r.user_id,
      role: r.role as AppRole,
      created_at: r.created_at,
    })));

    const { data: invites } = await supabase
      .from("invitations")
      .select("*")
      .order("created_at", { ascending: false });

    setInvitations((invites || []).map(i => ({
      id: i.id,
      email: i.email,
      role: i.role as AppRole,
      status: i.status,
      created_at: i.created_at,
    })));

    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("Enter an email"); return; }
    setSending(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSending(false); return; }

    // Create invitation record
    const { error } = await supabase.from("invitations").insert({
      invited_by: user.id,
      email: inviteEmail.trim(),
      role: inviteRole,
    });

    if (error) {
      toast.error("Failed to create invitation");
      setSending(false);
      return;
    }

    // Send magic link via Supabase Auth
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: inviteEmail.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    });

    if (authError) {
      toast.warning("Invitation saved but email may not have been sent. User can sign up manually.");
    } else {
      toast.success(`Invitation sent to ${inviteEmail}`);
    }

    setInviteEmail("");
    setShowInvite(false);
    setSending(false);
    loadData();
  };

  const handleChangeRole = async (memberId: string, newRole: AppRole) => {
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole })
      .eq("id", memberId);

    if (error) toast.error("Failed to update role");
    else { toast.success("Role updated"); loadData(); }
  };

  const handleRemoveMember = async (memberId: string) => {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("id", memberId);

    if (error) toast.error("Failed to remove member");
    else { toast.success("Member removed"); loadData(); }
  };

  if (!isAdmin) {
    return (
      <Card className="p-6 text-center">
        <Shield className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium">Admin access required</p>
        <p className="text-xs text-muted-foreground mt-1">Only admins can manage team members.</p>
      </Card>
    );
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const roleBadgeClass: Record<AppRole, string> = {
    admin: "bg-primary/15 text-primary",
    buyer: "bg-blue-500/15 text-blue-600",
    warehouse: "bg-amber-500/15 text-amber-600",
    viewer: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Team Members</h3>
          <p className="text-xs text-muted-foreground">{members.length} members</p>
        </div>
        <Button size="sm" variant="teal" onClick={() => setShowInvite(true)}>
          <UserPlus className="w-4 h-4 mr-1" /> Invite
        </Button>
      </div>

      {/* Members list */}
      <div className="space-y-2">
        {members.map(m => (
          <Card key={m.id} className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
              {m.user_id.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono truncate">{m.user_id.slice(0, 8)}…</p>
              <p className="text-[10px] text-muted-foreground">
                Joined {new Date(m.created_at).toLocaleDateString()}
              </p>
            </div>
            <Select
              value={m.role}
              onValueChange={(v) => handleChangeRole(m.id, v as AppRole)}
            >
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as AppRole[]).map(r => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive"
              onClick={() => handleRemoveMember(m.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </Card>
        ))}
      </div>

      {/* Pending invitations */}
      {invitations.filter(i => i.status === "pending").length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Pending Invitations
          </h4>
          {invitations.filter(i => i.status === "pending").map(inv => (
            <Card key={inv.id} className="p-3 flex items-center gap-3">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate">{inv.email}</p>
              </div>
              <Badge className={`text-[10px] ${roleBadgeClass[inv.role]}`}>
                {ROLE_LABELS[inv.role]}
              </Badge>
            </Card>
          ))}
        </div>
      )}

      {/* Role legend */}
      <div className="border border-border rounded-lg p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Role permissions</p>
        {(Object.keys(ROLE_LABELS) as AppRole[]).map(r => (
          <div key={r} className="flex items-start gap-2">
            <Badge className={`text-[10px] shrink-0 mt-0.5 ${roleBadgeClass[r]}`}>{ROLE_LABELS[r]}</Badge>
            <p className="text-[10px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
          </div>
        ))}
      </div>

      {/* Invite dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>Send a magic link to invite someone to your team.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Email</label>
              <Input
                placeholder="team@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Role</label>
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as AppRole)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as AppRole[]).map(r => (
                    <SelectItem key={r} value={r}>
                      <div>
                        <p className="text-sm">{ROLE_LABELS[r]}</p>
                        <p className="text-[10px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button variant="teal" size="sm" onClick={handleInvite} disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Mail className="w-4 h-4 mr-1" />}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
