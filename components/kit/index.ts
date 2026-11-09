/**
 * The kit: React components that render prototype/kit.html's exact markup and class names (styles in
 * app/tokens.css). Import from '@/components/kit'. Frozen during the build; requests go to docs/requests/.
 */

export { cx } from './cx';
export { Kbd, KBD_SHORTCUTS, useKbdText } from './kbd';
export { Button, ButtonLink, ButtonRow, buttonClass, type ButtonProps, type ButtonLinkProps, type ButtonVariant, type ButtonSize } from './button';
export { Tag, SampleTag, RealTag, Verdict, VERDICT_LABEL, Cap, type TagKind, type VerdictKind } from './pills';
export { Field, LabelRow, Label, Help, ErrorText, Counter, Input, Textarea, CodeInput, type InputProps, type TextareaProps } from './forms';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './radio-group';
export { Switch, SwitchRow, type SwitchProps, type SwitchRowProps } from './switch';
export {
  Panel,
  Card,
  List,
  ListHead,
  Row,
  RowToggle,
  RowLine1,
  RowName,
  RowLoc,
  RowAside,
  RowBody,
  RowFoot,
  RowDetail,
  Facts,
  Notice,
  Stats,
  Stat,
  Metric,
  HBar,
  Crumbs,
  Disclosure,
  Popover,
  Hr,
  ProtoNote,
  type FactItem,
  type NoticeKind,
  type RowProps,
} from './surfaces';
export { Clause, Mark, TrapMark, RulesReadView, RulesMissing, type RulesReadViewProps } from './clause';
export { Trace, TraceLine, T, Diff, Bar, type TraceTone, type DiffLine } from './blocks';
export { CodeBlock, copyText } from './code-block';
export { OfferCard, orderFacts, FACT_ORDER, type OfferCardProps } from './offer-card';
export { Waffle, Legend, glyphFor, CELL_GLYPH, type WaffleCellData } from './waffle';
export { Tabs, type TabItem } from './tabs';
