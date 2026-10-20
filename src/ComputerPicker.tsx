import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { displayAddress } from './connection';
import type { ConnectionLibrary, SavedComputer } from './connection-store';
import { Icon } from './Icons';
import { LoggedPressable as Pressable } from './LoggedPressable';
import { ScreenSafeArea } from './ScreenSafeArea';

export function ComputerPicker({ library, dark, busy, connected, fromSettings, onClose, onAdd, onSelect, onRemove }: {
  library: ConnectionLibrary;
  dark: boolean;
  busy: boolean;
  connected: boolean;
  fromSettings: boolean;
  onClose(): void;
  onAdd(): void;
  onSelect(computer: SavedComputer): void;
  onRemove(computer: SavedComputer): void;
}) {
  const [editing, setEditing] = useState(false);
  const ink = dark ? '#f2f2f4' : '#17181b';
  const surface = dark ? '#1c1d21' : '#fff';
  return <ScreenSafeArea edges={['bottom']} style={styles.page}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={fromSettings ? '返回设置' : '关闭电脑列表'}
        onPress={onClose} style={({ pressed }) => [styles.headerButton, { backgroundColor: surface }, pressed && styles.pressed]}>
        <Icon name={fromSettings ? 'back' : 'close'} color={ink} />
      </Pressable>
      <Text style={[styles.title, { color: ink }]}>电脑</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? '完成编辑电脑列表' : '编辑电脑列表'} disabled={busy}
        onPress={() => setEditing((value) => !value)} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
        <Text style={[styles.edit, { color: ink }]}>{editing ? '完成' : '编辑'}</Text>
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.group, { backgroundColor: surface }]}>
        {library.computers.map((computer, index) => {
          const current = computer.id === library.activeId;
          return <View key={computer.id} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: dark ? '#303137' : '#ededf0' }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`连接${computer.name}`}
              accessibilityState={{ selected: current, disabled: busy }} disabled={busy}
              onPress={() => onSelect(computer)}
              style={({ pressed }) => [styles.select, pressed && styles.pressed]}>
              <Icon name="computer" size={23} color={ink} />
              <View style={styles.details}>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={[styles.name, { color: ink }]}>{computer.name}</Text>
                  {current && <Text style={styles.current}>{connected ? '已连接' : '当前'}</Text>}
                </View>
                <Text numberOfLines={1} style={styles.address}>{displayAddress(computer.url)}</Text>
              </View>
              {!editing && current && <Icon name="check" size={20} color="#4d6bfe" />}
            </Pressable>
            {editing && <Pressable accessibilityRole="button" accessibilityLabel={`移除${computer.name}`} disabled={busy}
              onPress={() => onRemove(computer)} style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
              <Icon name="remove" size={21} color="#d45c54" />
            </Pressable>}
          </View>;
        })}
        <Pressable accessibilityRole="button" accessibilityLabel="添加电脑" disabled={busy} onPress={onAdd}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
          <Icon name="plus" size={23} color={ink} />
          <Text style={[styles.name, { color: ink }]}>添加电脑</Text>
        </Pressable>
      </View>
    </ScrollView>
  </ScreenSafeArea>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { height: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '600' },
  edit: { fontSize: 15 },
  content: { padding: 16, width: '100%', maxWidth: 540, alignSelf: 'center' },
  group: { borderRadius: 24, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center' },
  select: { flex: 1, flexDirection: 'row', gap: 14, alignItems: 'center', minHeight: 86, paddingVertical: 16 },
  details: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, flexShrink: 1 },
  current: { color: '#7e858f', fontSize: 11 },
  address: { color: '#96989d', fontSize: 12, marginTop: 5 },
  remove: { width: 44, minHeight: 50, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  add: { minHeight: 60, flexDirection: 'row', gap: 14, alignItems: 'center' },
  pressed: { opacity: .55 },
});
