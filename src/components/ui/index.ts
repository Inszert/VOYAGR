/**
 * Design system barrel.
 *
 * Components are imported from here rather than from their individual files, so
 * the set of approved primitives is visible in one place and an ad-hoc
 * one-off component is obvious in review.
 *
 * See `docs/design-system.md` for the rationale, the Radix/Tailwind split and
 * the accessibility rules every component here is expected to hold to.
 */

export { Badge, type BadgeProps, type BadgeTone } from './badge';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './button';
export {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  type CardElevation,
  type CardProps,
  type CardSurface,
  type CardTitleProps,
} from './card';
export { Disclosure, type DisclosureProps } from './disclosure';
export { EmptyState, Skeleton, type EmptyStateProps, type SkeletonProps } from './feedback';
export { Field, type FieldProps } from './field';
export {
  RadioChip,
  Tag,
  ToggleChip,
  type RadioChipProps,
  type TagProps,
  type TagTone,
  type ToggleChipProps,
} from './tag';
export { DemoDataNotice, ProvenanceBadge, type ProvenanceBadgeProps } from './provenance-badge';
export { Select, type SelectOption, type SelectProps } from './select';
export { SkipLink, type SkipLinkProps } from './skip-link';
