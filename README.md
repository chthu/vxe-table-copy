# vxe-table-component
``` ts
<vxe-table
        ref="ytXTableRef"
        @keydown="keydownEvent"
        @header-cell-click="headerCellClick"
      ></vxe-table>
// <script lang="ts" setup>
import { useAreaCopy } from '../use/useAreaCopy';
const ytXTableRef = ref<VxeTableInstance>();
vxe-table的表格单元格内容复制功能
// 区域复制功能
const { copySave, bindFixedEvent, update, selectAll, selectedList, headerClick, isEffect } = useAreaCopy({
  vxeTableRef: ytXTableRef,
  config: props.areaCopyConfig,
});
watch(
  () => selectedList.value,
  debounce(() => {
    selectChangeEvent(null);
  }, 120),
);
// 选中回调
const selectChangeEvent: VxeTableEvents.CheckboxChange = () => {
  const $table = ytXTableRef.value;
  const records = $table.getCheckboxRecords();
  emits('selectionChange', records);
};
// 键盘按下事件
const keydownEvent = (e: any) => {
  // 启动框选复制
  if (isEffect.value && (e.$event.ctrlKey || e.$event.metaKey)) {
    if (e.$event.key === 'c' || e.$event.key === 'C') {
      copySave?.(e.$event);
      e.$event.preventDefault();
    } else if ((e.$event.key === 'h' || e.$event.key === 'H') && ytXTableRef.value?.showHeader) {
      copySave?.(e.$event, true);
      e.$event.preventDefault();
    } else if (e.$event.key === 'a' || e.$event.key === 'A') {
      selectAll?.();
      e.$event.preventDefault();
    }
  }

  emits('keydown', e);
};
// 表头点击事件
const headerCellClick = async (e: any) => {
  headerClick(e);
  emits('headerCellClick', e);
};
```
