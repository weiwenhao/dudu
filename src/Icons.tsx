import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Link from 'lucide-react-native/icons/link';
import Menu from 'lucide-react-native/icons/menu';
import Monitor from 'lucide-react-native/icons/monitor';
import PanelRight from 'lucide-react-native/icons/panel-right';
import Plus from 'lucide-react-native/icons/plus';
import QrCode from 'lucide-react-native/icons/qr-code';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import Settings from 'lucide-react-native/icons/settings';
import SquarePen from 'lucide-react-native/icons/square-pen';
import X from 'lucide-react-native/icons/x';
import UserRound from 'lucide-react-native/icons/user-round';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Brain from 'lucide-react-native/icons/brain';
import Plug from 'lucide-react-native/icons/plug';
import Bot from 'lucide-react-native/icons/bot';
import Store from 'lucide-react-native/icons/store';
import Trash from 'lucide-react-native/icons/trash';
import Svg, { Path } from 'react-native-svg';
import { FISH_PATH } from './brand-path';

const icons = {
  menu: Menu, panel: PanelRight, new: SquarePen, plus: Plus,
  settings: Settings, close: X, back: ChevronLeft, chevron: ChevronRight,
  down: ChevronDown, check: Check, computer: Monitor, refresh: RotateCw,
  qr: QrCode, link: Link, account: UserRound, preferences: SlidersHorizontal,
  model: Brain, plugins: Plug, agent: Bot, store: Store, remove: Trash,
};

export type IconName = keyof typeof icons;

export function settingsIcon(label: string): IconName {
  if (/账号|账户|余额|account|billing/i.test(label)) return 'account';
  if (/通用|general|appearance/i.test(label)) return 'preferences';
  if (/模型|model/i.test(label)) return 'model';
  if (/市场|market|store/i.test(label)) return 'store';
  if (/插件|plugin|connector/i.test(label)) return 'plugins';
  if (/预设|agent|preset/i.test(label)) return 'agent';
  return 'settings';
}

export function Icon({ name, color = '#17181b', size = 23 }: { name: IconName; color?: string; size?: number }) {
  const Component = icons[name];
  return <Component size={size} color={color} strokeWidth={1.8} />;
}

export function Fish({ size = 44 }: { size?: number }) {
  return <Svg width={size} height={size * 17.04 / 23.16} viewBox="0 0 23.16 17.04">
    <Path d={FISH_PATH} fill="#4d6bfe" />
  </Svg>;
}
