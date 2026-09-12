export default function AlderLogo({
  surface = "light",
}: {
  surface?: "light" | "dark";
}) {
  return (
    <span className="alder-logo" aria-hidden="true">
      <img
        src={`/branding/alder-logo-${surface === "dark" ? "white" : "black"}.png`}
        alt=""
        draggable={false}
      />
    </span>
  );
}
