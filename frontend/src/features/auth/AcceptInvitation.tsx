import { MemberProfileForm, type MemberProfileInput } from "../members/MemberProfileForm";
import { invokeMemberApi } from "../../lib/supabase";

type AcceptInvitationProps = {
  onComplete: () => void | Promise<void>;
};

export function AcceptInvitation({ onComplete }: AcceptInvitationProps) {
  async function completeProfile(input: MemberProfileInput) {
    await invokeMemberApi("complete_profile", input);
    await onComplete();
  }

  return (
    <section className="card auth-card" aria-labelledby="invitation-heading">
      <h1 id="invitation-heading">Complete your profile</h1>
      <p>Welcome to the Camping Club. Fill in your details to finish setting up your account.</p>
      <MemberProfileForm
        mode="complete"
        initialDisplayName=""
        initialPhone=""
        initialMethod="venmo"
        onSave={completeProfile}
      />
    </section>
  );
}
