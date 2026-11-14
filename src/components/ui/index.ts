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

export { AmountSlider, roomFor, type AmountSliderProps } from './amount-slider';
export { Badge, type BadgeProps, type BadgeTone } from './badge';
export {
  Button,
  type ButtonProps,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from './button';
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
export { Container, type ContainerProps } from './container';
export { CalendarMonth, type CalendarMonthProps } from './calendar-month';
export { DateField, type DateFieldProps } from './date-field';
export { DateRangeField, type DateRangeFieldProps } from './date-range-field';
export { Disclosure, type DisclosureProps } from './disclosure';
export { EmptyState, Skeleton, type EmptyStateProps, type SkeletonProps } from './feedback';
export { Field, type FieldProps } from './field';
export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverPanel,
  PopoverTrigger,
  type PopoverPanelProps,
} from './popover';
export { FactGrid, type Fact, type FactGridProps } from './fact-grid';
export { Icon, type IconName, type IconProps } from './icon';
export { Media, washFor, type MediaImage, type MediaProps, type MediaScrim } from './media';
export { NumberStepperField, type NumberStepperFieldProps } from './number-stepper-field';
export { Price, type PriceProps, type PriceSize } from './price';
export {
  RadioChip,
  Tag,
  ToggleChip,
  type RadioChipProps,
  type TagProps,
  type TagTone,
  type ToggleChipProps,
} from './tag';
export {
  DemoDataNotice,
  ProvenanceBadge,
  ProvenanceBreakdown,
  type ProvenanceBadgeProps,
} from './provenance-badge';
export { Select, type SelectOption, type SelectProps } from './select';
export { SkipLink, type SkipLinkProps } from './skip-link';
export { SourceStrip, SourceTag, type SourceStripProps } from './source-strip';
export { UpdatedAgo, describeAge, type UpdatedAgoProps } from './updated-ago';
export { TimeRangeField, type TimeRangeFieldProps } from './time-range-field';
