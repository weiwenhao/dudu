import { Check, CheckCheck, ExternalLink, Forward, Plus, RefreshCw, RotateCcw, SquareArrowOutUpRight, SquareCheckBig, Trash2 } from 'lucide-react';

/**
 * The icons of the inbox's actions, drawn as one set (owner, 2026-11-21: "一堆图标感觉大小不一，尤其是补全上下文", then, of `.local/designs/inbox-menu-icons-2026-11-21/`, "收件箱菜单审核通过。选择就用复选框":
 * the phones draw them the same way). Lucide draws every icon in a 24 box, but the ink (line included) reaches different distances: the checkbox 21 x 20, the arrow and the check 18 x 13, the plus 16 x 16,
 * the refresh, the rotate and the external link 20 x 20, the trash can 20 x 22, so at one size the biggest has nearly twice the area of the smallest. The number is the side of the square that has the area
 * of the ink box (`measure.mjs` of that design); the key is the component itself (`Trash2` is `Trash` under another name, so its `displayName` is no key).
 */
const VISUAL = new Map([
  [SquareCheckBig, 20.5], [Forward, 15.3], [Plus, 16], [RefreshCw, 20], [Check, 15.3], [Trash2, 21],
  [RotateCcw, 20], [ExternalLink, 20], [SquareArrowOutUpRight, 20], [CheckCheck, 17.2],
]);

/**
 * One of those icons in the `slot` px the place gives an icon (16 in a menu row or a button, 12 in a small one): drawn at the box that gives every icon of the set the same visual size, three quarters
 * of the slot (12px in 16), with the line a Lucide icon has in that slot whatever the box (1.33px in 16). The room it takes stays the slot's (the box's difference is taken up by the margin), so
 * nothing around it moves; `has-[>svg]` on a button still sees its icon. The size is set inline because the row's and the button's `[&_svg]:size-*` would win over a class. Any other icon is left as it is.
 */
export function MenuIcon({ icon: Icon, slot = 16, style, ...props }) {
  const visual = VISUAL.get(Icon);
  if (!visual) return <Icon aria-hidden="true" style={style} {...props} />;
  const box = (slot * 18) / visual; // 24 * (3/4 * slot) / visual
  return <Icon aria-hidden="true" size={box} absoluteStrokeWidth strokeWidth={slot / 12} style={{ width: box, height: box, margin: (slot - box) / 2, ...style }} {...props} />;
}
