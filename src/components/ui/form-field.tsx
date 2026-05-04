import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Standard form field wrapper.
 *
 * Layout:
 *  - Label above input (13/medium)
 *  - Input slot (children) — should be ≥ 44px tall on touch
 *  - Helper text below (12/muted) OR error message (12/destructive)
 *
 * Usage:
 * <FormField label="Email" htmlFor="email" helper="We'll never share it" error={errors.email}>
 *   <Input id="email" />
 * </FormField>
 */
interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function FormField({
  label,
  htmlFor,
  helper,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <Label
          htmlFor={htmlFor}
          className="text-[13px] font-medium text-foreground"
        >
          {label}
          {required ? <span className="text-destructive ml-0.5">*</span> : null}
        </Label>
      ) : null}

      <div data-error={error ? "true" : undefined} className="form-field-control">
        {children}
      </div>

      {error ? (
        <p className="text-[12px] text-destructive leading-tight">{error}</p>
      ) : helper ? (
        <p className="text-[12px] text-muted-foreground leading-tight">{helper}</p>
      ) : null}
    </div>
  );
}

/**
 * FormSection — group related fields with an optional title + description.
 * Use inside Modal body or page form to create the Apple-style stacked sections.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title ? (
        <header className="space-y-0.5">
          <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
          {description ? (
            <p className="text-[12px] text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}
