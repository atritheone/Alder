import { indexGroup } from "./documentIndex";
export default function IndexGroupSelect({
  value,
  onChange,
  disabled = false,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      Index group
      <select
        aria-label="Index group"
        value={indexGroup(value)}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === "I" ? null : event.target.value)
        }
      >
        <option value="I">General</option>
        {Array.from({ length: 26 }, (_, index) =>
          String.fromCharCode(65 + index),
        )
          .filter((group) => group !== "I")
          .map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
      </select>
    </label>
  );
}
