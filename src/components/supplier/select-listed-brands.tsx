"use client";

export function SelectListedBrands() {
  return (
    <button type="button" className="min-h-11 w-fit text-sm font-medium underline" onClick={(event) => {
      const choices = event.currentTarget.closest("fieldset")?.querySelectorAll<HTMLInputElement>('input[name="brandIds"]');
      choices?.forEach((choice) => { choice.checked = true; });
    }}>Select all listed brands</button>
  );
}
