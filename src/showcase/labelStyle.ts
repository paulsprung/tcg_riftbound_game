/**
 * The look of the slab labels: pearl (white), midnight (navy and gold) or
 * onyx (black); a pristine 10 adds gold to any of them. Pearl is the look
 * now; the switch is gone, so stored choices are ignored.
 */
export type LabelStyle = 'pearl' | 'midnight' | 'onyx';

export function useLabelStyle(): LabelStyle {
  return 'pearl';
}
