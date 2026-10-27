import { LoaderCircle } from "lucide-react";

export function LoadingPill() {
  return (
    <div className="loading-pill">
      <LoaderCircle className="spin" size={16} />
      Actualizando
    </div>
  );
}
