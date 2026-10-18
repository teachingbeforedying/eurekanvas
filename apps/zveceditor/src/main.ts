const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#canvas not found");

const context = canvas.getContext("2d");
if (!context) throw new Error("2d context not available");

function resize(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

window.addEventListener("resize", () => resize(canvas, context));
resize(canvas, context);
