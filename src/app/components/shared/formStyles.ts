/**
 * Shared form label styles used across modal and form components.
 * Extracted from ModelFieldEditor, CollectionFormModal, RequestFormModal, EnvironmentFormModal.
 */

/**
 * Standard section label — uppercase, spaced, tertiary color.
 * Used for form section headings like "Name", "Description", "Fields".
 */
export const labelStyle = {
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 4,
  display: 'block',
};

/**
 * Compact column header label — slightly smaller than labelStyle.
 * Used for inline grid column headings inside field editor tables.
 */
export const fieldLabelStyle = {
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};
