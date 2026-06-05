import { useState, useCallback } from 'react';

/**
 * useFormValidation — reusable form validation hook
 *
 * Usage:
 *   const { errors, validate, clearErrors, clearError } = useFormValidation();
 *
 *   const rules = {
 *     name:  [required(), minLength(2), maxLength(100)],
 *     email: [required(), email()],
 *     qty:   [required(), number(), min(1), max(9999)],
 *   };
 *
 *   const handleSubmit = () => {
 *     if (!validate(formValues, rules)) return; // stops if invalid
 *     // proceed...
 *   };
 */

// ─── Built-in Validators ───────────────────────────────────────────────────────

export const required = (msg) => (val) =>
  (!val && val !== 0) || (typeof val === 'string' && !val.trim())
    ? (msg || 'This field is required')
    : null;

export const minLength = (n, msg) => (val) =>
  val && val.length < n ? (msg || `Minimum ${n} characters required`) : null;

export const maxLength = (n, msg) => (val) =>
  val && val.length > n ? (msg || `Maximum ${n} characters allowed`) : null;

export const isNumber = (msg) => (val) =>
  val !== '' && val !== undefined && isNaN(Number(val)) ? (msg || 'Must be a number') : null;

export const min = (n, msg) => (val) =>
  val !== '' && Number(val) < n ? (msg || `Minimum value is ${n}`) : null;

export const max = (n, msg) => (val) =>
  val !== '' && Number(val) > n ? (msg || `Maximum value is ${n}`) : null;

export const isEmail = (msg) => (val) =>
  val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? (msg || 'Enter a valid email address') : null;

export const pattern = (regex, msg) => (val) =>
  val && !regex.test(val) ? (msg || 'Invalid format') : null;

export const noSpecialChars = (msg) => (val) =>
  val && /[<>'";&]/.test(val) ? (msg || 'Special characters <>\'";&  are not allowed') : null;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFormValidation() {
  const [errors, setErrors] = useState({});

  /**
   * Validate a form values object against a rules map.
   * @param {object} values  - { fieldName: value }
   * @param {object} rules   - { fieldName: [validator, ...] }
   * @returns {boolean} true if all valid, false if any error
   */
  const validate = useCallback((values, rules) => {
    const newErrors = {};
    let valid = true;

    for (const field of Object.keys(rules)) {
      const val = values[field];
      for (const validator of rules[field]) {
        const err = validator(val);
        if (err) {
          newErrors[field] = err;
          valid = false;
          break; // only show first error per field
        }
      }
    }

    setErrors(newErrors);
    return valid;
  }, []);

  const clearErrors = useCallback(() => setErrors({}), []);

  const clearError = useCallback((field) => {
    setErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  /** Touch a single field and validate it immediately (for real-time validation) */
  const validateField = useCallback((field, value, fieldRules) => {
    for (const validator of fieldRules) {
      const err = validator(value);
      if (err) {
        setErrors(prev => ({ ...prev, [field]: err }));
        return false;
      }
    }
    setErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    return true;
  }, []);

  return { errors, validate, clearErrors, clearError, validateField };
}

// ─── FormField helper component ───────────────────────────────────────────────

/**
 * FormField — wraps an input with label and inline error message
 *
 * Usage:
 *   <FormField label="Product Name" error={errors.name} required>
 *     <input className="form-input" ... />
 *   </FormField>
 */
export function FormField({ label, error, required: req, children, style }) {
  return (
    <div className="form-group" style={style}>
      {label && (
        <label className="form-label">
          {label}
          {req && <span style={{ color: '#e74c3c', marginLeft: 3 }}>*</span>}
        </label>
      )}
      {children}
      {error && (
        <div style={{
          marginTop: 4, fontSize: 12, color: '#e74c3c',
          display: 'flex', alignItems: 'center', gap: 4
        }}>
          <span>⚠</span> {error}
        </div>
      )}
    </div>
  );
}
