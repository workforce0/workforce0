import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition-all duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-canvas)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-[0.985] select-none",
  {
    variants: {
      variant: {
        default: "bg-ink text-ink-inverse font-semibold shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(5,5,9,0.4),0_0_0_1px_rgba(5,5,9,0.6)] hover:brightness-125 focus-visible:ring-ink",
        destructive: "bg-rose text-white font-semibold shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,var(--shadow-card)] hover:bg-rose/90 focus-visible:ring-rose",
        outline: "border border-[color:var(--color-border-strong)] bg-surface text-ink font-semibold hover:bg-surface-hover hover:border-ink/30 focus-visible:ring-ink",
        secondary: "bg-surface-sunken text-ink font-semibold hover:bg-surface-hover focus-visible:ring-ink",
        ghost: "text-ink-secondary hover:bg-[var(--color-surface-sunken)] hover:text-ink",
        link: "text-ink underline-offset-4 hover:underline",
        success: "bg-emerald text-white font-semibold shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,var(--shadow-card)] hover:bg-emerald/90 focus-visible:ring-emerald",
        /* Impact pass: the accent CTA gets a top-to-bottom gradient (Apple-style
           pressable button), a stronger inner highlight, and a harder drop. */
        accent:
          "shine font-semibold text-white bg-gradient-to-b from-[color:var(--color-accent-hover)] to-[color:var(--color-accent-active)] " +
          "shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_1px_2px_rgba(55,48,163,0.4),0_4px_12px_rgba(79,70,229,0.35)] " +
          "hover:brightness-110 hover:shadow-[0_1px_0_rgba(255,255,255,0.3)_inset,0_2px_6px_rgba(55,48,163,0.5),0_8px_24px_rgba(79,70,229,0.45)] " +
          "focus-visible:ring-accent",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-[var(--radius)] px-3 text-xs",
        lg: "h-12 rounded-[var(--radius-md)] px-6 text-[15px]",
        icon: "h-10 w-10 rounded-[var(--radius-md)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
