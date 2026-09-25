import { useContext } from "react";
import { OTPInputContext } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSeparator } from "@/components/ui/input-otp";
import { hsCodeDigitsOnly } from "@/lib/hs-code-format";

// Segmented 0000.00.00.00 entry — the shape is baked into the input itself
// (four boxes, dots between groups, "_" placeholders) so there's nothing to
// mistype the format of. Reports the raw 10-digit string (no dots) to the
// caller; convert with normalizeHsCodeForStorage() before persisting.
function Slot({ index }: { index: number }) {
  const ctx = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = ctx.slots[index];
  return (
    <div
      className={`relative flex h-8 w-6 items-center justify-center border-y border-r border-input text-sm shadow-sm first:rounded-l-md first:border-l last:rounded-r-md ${
        isActive ? "z-10 ring-1 ring-ring" : ""
      }`}
    >
      <span className={char ? undefined : "text-muted-foreground/40"}>{char || "_"}</span>
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
}

const Dot = () => (
  <InputOTPSeparator>
    <span className="px-0.5 text-muted-foreground">.</span>
  </InputOTPSeparator>
);

export function HsCodeInput({
  value,
  onChange,
  disabled,
  id,
  ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (digits: string) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <InputOTP
      id={id}
      maxLength={10}
      value={hsCodeDigitsOnly(value)}
      onChange={onChange}
      disabled={disabled}
      inputMode="numeric"
      pattern="^[0-9]*$"
      aria-label={ariaLabel}
    >
      <InputOTPGroup>
        {[0, 1, 2, 3].map((i) => (
          <Slot key={i} index={i} />
        ))}
      </InputOTPGroup>
      <Dot />
      <InputOTPGroup>
        {[4, 5].map((i) => (
          <Slot key={i} index={i} />
        ))}
      </InputOTPGroup>
      <Dot />
      <InputOTPGroup>
        {[6, 7].map((i) => (
          <Slot key={i} index={i} />
        ))}
      </InputOTPGroup>
      <Dot />
      <InputOTPGroup>
        {[8, 9].map((i) => (
          <Slot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
