import { forwardRef } from "react";
import Link from "next/link";
import { clsx } from "clsx";

// NOTE: button.css is loaded globally from the root layout (src/app/layout.tsx),
// NOT imported here. Per-component CSS imports break the node/tsx test runner
// (it can't parse `import "./x.css"`), and this repo keeps stylesheets global.

/**
 * PHOSPHOR LADDER command-key button.
 *
 * The shared CTA / action control, restyled from the retired emerald Tailwind
 * pill into the "command key" system (see button.css): a mono-labelled, debossed
 * violet key with a CSS-only detent press + phosphor-flare on :active. Color is
 * signal only — violet = brand chrome, bear = destructive, green = SEMANTIC
 * confirm (never the default). Idle cost is zero; nothing animates at rest.
 *
 * Backwards-compatible: the existing prop API is preserved verbatim — every
 * current callsite passes `variant ∈ {primary,ghost,outline,danger}` and
 * `size ∈ {sm,md}`. The unions are only EXTENDED (secondary/confirm, xs/lg), so
 * no callsite breaks. `outline` (the old emerald secondary CTA) now maps to the
 * violet `secondary` key.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "confirm";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show the return-ring spinner and disable interaction. */
  loading?: boolean;
  /** Stretch to fill the container width. */
  block?: boolean;
  children?: React.ReactNode;
  className?: string;
};

type ButtonAsButton = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps | "href"> & {
    as?: "button";
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
    /** Provide an href to render a Next.js <Link> (or a plain <a> when external). */
    href: string;
    /** Render a plain external anchor (target=_blank, rel=noopener) instead of <Link>. */
    external?: boolean;
    disabled?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

// The old emerald `outline` CTA maps onto the violet secondary command key; every
// other name is 1:1 with a button.css variant class.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bo-btn--primary",
  secondary: "bo-btn--secondary",
  outline: "bo-btn--secondary",
  ghost: "bo-btn--ghost",
  danger: "bo-btn--danger",
  confirm: "bo-btn--confirm",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "bo-btn--xs",
  sm: "bo-btn--sm",
  md: "bo-btn--md",
  lg: "bo-btn--lg",
};

/** The shared return-ring spinner (bead/ring motif) — pure CSS, reduced-motion aware. */
function Spinner() {
  return (
    <span className="bo-spinner" aria-hidden style={{ width: "1em", height: "1em" }}>
      <span className="bo-spinner__ring" />
      <span className="bo-spinner__ring--2" />
      <span className="bo-spinner__core" />
    </span>
  );
}

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = "primary",
      size = "md",
      loading = false,
      block = false,
      className,
      children,
    } = props;

    const classes = clsx(
      "bo-btn",
      VARIANT_CLASS[variant],
      SIZE_CLASS[size],
      block && "bo-btn--block",
      loading && "is-loading",
      className
    );

    const content = (
      // .bo-btn__inner sits at z-1, keeping the label above the keypress-flash bloom.
      <span className="bo-btn__inner">
        {loading && (
          <span className="bo-btn__icon">
            <Spinner />
          </span>
        )}
        <span className="bo-btn__label">{children}</span>
      </span>
    );

    if ("href" in props && props.href != null) {
      // Pull every owned prop out so only DOM-valid anchor attrs land on the node.
      const {
        href,
        external,
        disabled,
        variant: _v,
        size: _s,
        loading: _l,
        block: _b,
        className: _c,
        children: _ch,
        ...rest
      } = props as ButtonAsLink;

      const isInert = disabled || loading;
      const anchorProps = {
        ...rest,
        ref: ref as React.Ref<HTMLAnchorElement>,
        className: clsx(classes, isInert && "is-inert"),
        "aria-disabled": isInert || undefined,
        tabIndex: isInert ? -1 : rest.tabIndex,
      };

      if (external) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...anchorProps}>
            {content}
          </a>
        );
      }
      return (
        <Link href={href} {...anchorProps}>
          {content}
        </Link>
      );
    }

    const {
      type = "button",
      disabled,
      as: _as,
      variant: _v,
      size: _s,
      loading: _l,
      block: _b,
      className: _c,
      children: _ch,
      ...rest
    } = props as ButtonAsButton;

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={classes}
        {...rest}
      >
        {content}
      </button>
    );
  }
);
