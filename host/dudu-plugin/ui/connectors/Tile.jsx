/** A connector's icon on its tile. The tile is white in both themes, as the ones on Claude's and Muse's pages are, with a logo or a plain symbol on it. */
export function Tile({ icon, size = 36, radius }) {
  const inner = Math.round(size * 0.6);
  const { src, Glyph } = icon;
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border bg-white" style={{ width: size, height: size, ...(radius ? { borderRadius: radius } : {}) }}>
      {src && <img src={src} alt="" className="object-contain" style={{ width: inner, height: inner }} />}
      {Glyph && <Glyph className="text-neutral-700" strokeWidth={1.6} style={{ width: inner, height: inner }} aria-hidden="true" />}
    </span>
  );
}
