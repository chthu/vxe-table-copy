import { type VxeTableInstance } from 'vxe-table';
import message from '../../dc-message';
import {
  type Ref,
  type Plugin,
  type App,
  ref,
  onMounted,
  nextTick,
  onBeforeUnmount,
  computed,
  render,
  createVNode,
  watch,
  unref,
  getCurrentInstance,
  reactive,
} from 'vue';
import { get, throttle, debounce, cloneDeep } from 'lodash-es';
import { _log, error } from '../../_utils/log';
import { useI18n } from 'vue-i18n';
import { useRef } from '../useRef';
import { textCopy } from '../../_utils';

const toNumber = (value: string) => {
  if (!value) return -1;
  return Number(value.match(/\d+/g)?.[0]);
};
type TableFormatOption = {
  keys: string[];
  format: (val: any, row: any) => any;
};
type ExpandHeight = {
  height: number;
  topHeight: number;
};
type TableareaCopyConfig =
  | {
      isAreaCopy?: boolean; // 是否开启区域复制(兼容旧版本)
      copy?: boolean; // 是否开启区域复制（新版本）
      extension?: boolean; // 复制区域是否可扩展
      header?: boolean; // 是否开启表头可点击复制
      formatOptions?: TableFormatOption[] | null; // 格式化选项
    }
  | boolean;
type SelectRow = {
  rowIndex: number;
  rowId: string;
  rowRect: DOMRect;
  bodyWrapperRect: DOMRect;
  scrollTop: number;
  colIndex: number;
  span: { colspan: number; rowspan: number };
  column: Record<string, any>;
  expandHeight: ExpandHeight;
};

/**
 * vxetable表格框选复制功能
 */
export function useAreaCopy({
  vxeTableRef,
  config,
}: {
  vxeTableRef: Ref<VxeTableInstance>;
  config: TableareaCopyConfig;
}) {
  const { t: $t } = useI18n();
  // 合并area-copy-config

  const areaCopyConfig = computed(() => {
    const defaultConfig: any = { copy: false, extension: true, header: true, checkbox: true, formatOptions: [] };
    if (typeof config === 'boolean') {
      return Object.assign({ ...defaultConfig }, { copy: config });
    } else {
      return Object.assign({ ...defaultConfig }, unref(config ?? {}));
    }
  });
  const keyField = computed(() => vxeTableRef.value?.rowConfig?.keyField ?? '_X_ROW_KEY');
  const formatOptions = computed(() => areaCopyConfig.value?.formatOptions || []);
  const rowHeight = computed(() => vxeTableRef.value?.rowConfig?.height);
  const showHeader = computed(() => vxeTableRef.value?.showHeader);
  const scrollSatus = computed(() => vxeTableRef.value?.getScroll());
  const isEffect = computed(() => {
    const treeConfig = vxeTableRef.value?.treeConfig; // 是否启用树形结构
    const isTransform = !!treeConfig?.transform; // 是否启用树形结构转换
    if (!!treeConfig && !isTransform) {
      return false;
    }
    // 是否可配置
    return areaCopyConfig.value?.copy || areaCopyConfig.value?.isAreaCopy; // 功能是否最终生效
  });
  //鼠标滑动选中
  const isSelecting = ref(false); // 是否正在进行选择操作,默认为false
  const [isChecked, resetChecked] = useRef(true); // 是否选择复选框

  const [selectionStart, resetStart] = useRef<SelectRow>({
    rowIndex: -1,
    rowId: null,
    rowRect: {} as DOMRect,
    bodyWrapperRect: {} as DOMRect,
    scrollTop: 0,
    colIndex: -1,
    span: { colspan: 0, rowspan: 0 },
    column: {},
    expandHeight: { height: 0, topHeight: 0 },
  }); // 选择操作起始单元格位置
  const [selectionEnd, resetEnd] = useRef<SelectRow>({
    rowIndex: -1,
    rowId: null,
    rowRect: {} as DOMRect,
    bodyWrapperRect: {} as DOMRect,
    scrollTop: 0,
    colIndex: -1,
    span: { colspan: 0, rowspan: 0 },
    column: {},
    expandHeight: { height: 0, topHeight: 0 },
  }); // 选择操作结束单元格位置
  const [copiedSelectionStart, resetCopiedStart] = useRef<SelectRow>({
    rowIndex: -1,
    rowId: null,
    rowRect: {} as DOMRect,
    bodyWrapperRect: {} as DOMRect,
    scrollTop: 0,
    colIndex: -1,
    span: { colspan: 0, rowspan: 0 },
    column: {},
    expandHeight: { height: 0, topHeight: 0 },
  }); // 选择操作起始单元格位置
  const [copiedSelectionEnd, resetCopiedEnd] = useRef<SelectRow>({
    rowIndex: -1,
    rowId: null,
    rowRect: {} as DOMRect,
    bodyWrapperRect: {} as DOMRect,
    scrollTop: 0,
    colIndex: -1,
    span: { colspan: 0, rowspan: 0 },
    column: {},
    expandHeight: { height: 0, topHeight: 0 },
  }); // 选择操作结束单元格位置
  //获取vxetable表格节点
  //添加事件
  let tbody = null;

  let leftfixedtbody = null,
    rightfixedtbody = null;

  const cellarea = ref();
  const leftfixedcellarea = ref();
  const rightfixedcellarea = ref();
  const contextMenuArea = ref();
  const contextMenuAreaStyle: any = ref({
    display: 'none',
    position: 'fixed',
    zIndex: 9999,
  });
  const extensionStyle = computed(() => {
    return { display: areaCopyConfig.value.extension ? 'block' : 'none' };
  });

  const visibleColumn = computed(() => vxeTableRef.value?.getTableColumn?.()?.visibleColumn ?? []); //获取处理条件之后的全量表头列

  const tableData = computed(() => vxeTableRef.value?.getTableData?.());

  const visibleData = computed(() => tableData.value?.visibleData ?? []); //获取处理条件之后的全量表体数据
  const treeExpandVisibleRecords = computed(() => {
    return vxeTableRef.value?.getTreeExpandRecords() ?? [];
  });
  // 展开行Rect数据
  const expandRows = ref(new Map());

  /**
   * 展开行数据
   */

  const expandVisibleRecords = computed(() => {
    const records = vxeTableRef.value?.getRowExpandRecords() ?? [];
    return records.filter((record: any) => {
      return tableData.value?.tableData?.findIndex((row: any) => record[keyField.value] === row[keyField.value]) >= 0;
    });
  });
  /**
   * 树形行数据
   */

  const handleExpandRow = (val: any) => {
    nextTick(() => {
      if (val.length > 0) {
        val.forEach((row: any) => {
          if (!expandRows.value.has(row[keyField.value])) {
            const expandRow = vxeTableRef.value?.$el
              ?.querySelector(`.vxe-table--body-wrapper .vxe-body--row.is--expand-row[rowid="${row[keyField.value]}"]`)
              ?.nextElementSibling?.getBoundingClientRect();
            if (expandRow) {
              expandRows.value.set(row[keyField.value], expandRow);
            }
          }
        });
      }
    });
  };
  // 处理树形结构复制区域区域
  const handleTreeExpandRow = () => {
    if (copiedArea.value) {
      destroyCopiedAreaBox();
    }
  };
  watch(() => expandVisibleRecords.value, debounce(handleExpandRow, 300));
  watch(() => treeExpandVisibleRecords.value, debounce(handleTreeExpandRow, 50));

  // 区域中/上方可见的所有展开行高度
  const getComputedHeight = (s: SelectRow, e: SelectRow): ExpandHeight => {
    const [start, end] = getOrderPosition(s, e);
    let height = 0,
      topHeight = 0;
    if (start.rowId && end.rowId) {
      expandVisibleRecords.value.forEach((row): any => {
        if (
          toNumber(start.rowId) <= toNumber(row[keyField.value]) &&
          toNumber(row[keyField.value]) < toNumber(end.rowId)
        ) {
          height += expandRows.value.get(row[keyField.value])?.height ?? 0;
        }
        if (toNumber(row[keyField.value]) < toNumber(start.rowId)) {
          topHeight += expandRows.value.get(row[keyField.value])?.height ?? 0;
        }
      });
    }

    return { height, topHeight };
  };

  const areaExpandHeight = computed<ExpandHeight>(() => {
    return getComputedHeight(selectionStart.value, selectionEnd.value);
  });
  // 区域顶部上方可见的所有展开行高度
  // copied区域顶部中、上方可见的所有展开行高度
  const copiedExpandHeight = computed(() => {
    return getComputedHeight(copiedSelectionStart.value, copiedSelectionEnd.value);
  });

  const clearTbodyListener = () => {
    if (tbody) {
      tbody.removeEventListener('mousedown', tbodymousedown); //给表格中的tbody添加鼠标按下事件
      tbody.removeEventListener('mousemove', throttleTbodymousemove); //给表格中的tbody添加鼠标移动事件
      tbody.oncontextmenu = null;
    }
  };
  const clearLeftTbodyListener = () => {
    if (leftfixedtbody) {
      leftfixedtbody.removeEventListener('mousedown', tbodymousedown);
      leftfixedtbody.removeEventListener('mousemove', throttleTbodymousemove);
      leftfixedtbody.oncontextmenu = null;
    }
  };
  const clearRightTbodyListener = () => {
    if (rightfixedtbody) {
      rightfixedtbody.removeEventListener('mousedown', tbodymousedown);
      rightfixedtbody.removeEventListener('mousemove', throttleTbodymousemove);
      rightfixedtbody.oncontextmenu = null;
    }
  };
  const bindFixedEvent = () => {
    nextTick(() => {
      //#region 左侧固定列
      if (!isEffect.value) return;
      leftfixedtbody = vxeTableRef.value?.$el?.querySelector(
        '.vxe-table--fixed-wrapper .vxe-table--fixed-left-wrapper .vxe-table--body-wrapper table tbody',
      ); //获取fixedtbody区域

      if (leftfixedtbody) {
        // 避免重复绑定
        clearLeftTbodyListener();
        leftfixedtbody.addEventListener('mousedown', tbodymousedown); //给表格中的leftfixedtbody添加鼠标按下事件
        leftfixedtbody.addEventListener('mousemove', throttleTbodymousemove); //给表格中的leftfixedtbody添加鼠标移动事件
        leftfixedtbody.oncontextmenu = tableCellMenuClick; //添加右键菜单事件
      }

      const leftFixedBodyWrapper = vxeTableRef.value?.$el?.querySelector(
        '.vxe-table--fixed-wrapper .vxe-table--fixed-left-wrapper .vxe-table--body-wrapper',
      );

      if (leftFixedBodyWrapper) {
        //注意这里的ref名称，这里是fixed区域的框的名称
        const leftFixedBodyArea = leftFixedBodyWrapper.querySelector('.vxe-table--cell-area');
        !leftFixedBodyArea && leftFixedBodyWrapper.appendChild(leftfixedcellarea.value);
      }
      //#endregion

      //#region 右侧固定列
      rightfixedtbody = vxeTableRef.value?.$el?.querySelector(
        '.vxe-table--fixed-wrapper .vxe-table--fixed-right-wrapper .vxe-table--body-wrapper table tbody',
      ); //获取fixedtbody区域

      if (rightfixedtbody) {
        clearRightTbodyListener();
        rightfixedtbody.addEventListener('mousedown', tbodymousedown); //给表格中的rightfixedtbody添加鼠标按下事件
        rightfixedtbody.addEventListener('mousemove', throttleTbodymousemove); //给表格中的rightfixedtbody添加鼠标移动事件
        rightfixedtbody.oncontextmenu = tableCellMenuClick; //添加右键菜单事件
      }

      const rightFixedBodyWrapper = vxeTableRef.value?.$el?.querySelector(
        '.vxe-table--fixed-wrapper .vxe-table--fixed-right-wrapper .vxe-table--body-wrapper',
      );
      if (rightFixedBodyWrapper) {
        //注意这里的ref名称，这里是fixed区域的框的名称
        const rightFixedBodyArea = rightFixedBodyWrapper.querySelector('.vxe-table--cell-area');
        !rightFixedBodyArea && rightFixedBodyWrapper.appendChild(rightfixedcellarea.value);
      }
      //#endregion
    });
  };

  const tableCellMenuClick = async (e: MouseEvent) => {
    try {
      if (!isSelecting.value && isAreaBoxVisible.value) {
        e.preventDefault();
        const scroll = vxeTableRef.value?.getScroll();
        const { left } = cellAreaStyle.value;
        const horizontalFlag =
          selectionStart.value?.bodyWrapperRect.x + toNumber(left?.left ?? 0) - scroll.scrollLeft <= e.clientX &&
          e.clientX <=
            toNumber(left?.left ?? 0) +
              toNumber(left?.width ?? 0) +
              selectionStart.value.bodyWrapperRect.x -
              scroll.scrollLeft; //是否在范围框的水平判断标记
        const verticalFlag =
          selectionStart.value.bodyWrapperRect.y + toNumber(left?.top ?? 0) - scroll.scrollTop <= e.clientY &&
          e.clientY <=
            toNumber(left?.top ?? 0) +
              toNumber(left?.height ?? 0) +
              selectionStart.value.bodyWrapperRect.y -
              scroll.scrollTop; //是否在范围框的垂直判断标记

        if (horizontalFlag && verticalFlag) {
          let top = '0px',
            left = '0px';
          contextMenuAreaStyle.value.display = 'block';
          nextTick(() => {
            const menuRect = contextMenuArea.value.getBoundingClientRect();
            if (e.clientY + menuRect.height > window.innerHeight) {
              top = `${e.clientY - menuRect.height}px`;
            } else {
              top = `${e.clientY}px`;
            }
            if (e.clientX + menuRect.width > window.innerWidth) {
              left = `${e.clientX - menuRect.width}px`;
            } else {
              left = `${e.clientX}px`;
            }
            contextMenuAreaStyle.value = { ...contextMenuAreaStyle.value, display: 'block', top, left };
          });
        }
      }
    } catch (error) {}
  };

  //鼠标按下事件
  let startMouseX = 0;
  let startMouseY = 0;

  const tbodymousedown = async (event: MouseEvent) => {
    try {
      if (!isEffect.value) return;
      //左键0,中键1,右键2
      if (event.button === 0) {
        //左键按下
        destroyAreaBox();
        // 记录选择操作起始位置
        selectionStart.value = await getCellPosition(event.target); //设置选择操作起始单元格位置
        startMouseX = event.clientX;
        startMouseY = event.clientY;
        // 每次按下修正是否移动状态
        resetChecked();
        getCheckedList(); // 每次点击获取选中状态
        isSelecting.value = true; //标记为正在选择操作
      }
    } catch (error) {}
  };

  // 鼠标按下移动灵敏度控制,越小越灵敏
  const responseRate = 12;
  const mouseMovingjudge = (event: MouseEvent, dis: number) => {
    const currentMouseX = event.clientX; // 当前鼠标x坐标
    const currentMouseY = event.clientY; // 当前鼠标y坐标
    let distanceX = -1,
      distanceY = -1;
    if (currentMouseX !== null && currentMouseY !== null) {
      distanceX = Math.abs(currentMouseX - startMouseX); // x坐标变化量
      distanceY = Math.abs(currentMouseY - startMouseY); // y坐标变化量
    }
    return distanceX >= dis || distanceY >= dis;
  };
  //鼠标移动事件
  const tbodymousemove = async (event: MouseEvent) => {
    try {
      if (event.button === 0 && event.buttons === 1) {
        //左键移动 鼠标移动灵敏度控制
        // 滑动距离不够、非正在选择操作，直接退出
        if (!mouseMovingjudge(event, responseRate) || !isSelecting.value) {
          return;
        }

        //记录选择操作结束位置
        selectionEnd.value = await getCellPosition(event.target);
        selectionEnd.value.expandHeight = cloneDeep(areaExpandHeight.value);
        //设置样式,并显示范围框
        await setSelectedCellArea();
        // scrollToCol(event.target, selectionEnd.value.column); //滚动到列边界
        // scrollToRow(event.target); //滚动到行边界
      } else {
        // 修正mouseup无法触发
        isSelecting.value = false;
      }
    } catch (error) {}
  };

  // 鼠标移动节流
  let throttleTbodymousemove = throttle(tbodymousemove, 60);
  //鼠标按键结束事件,添加在了window中
  const tbodymouseup = (event: MouseEvent) => {
    if (event.button === 0) {
      //左键松开
      isSelecting.value = false; //标记为停止选择操作
    }
    if (event.button === 2) {
      event.stopPropagation();
    }
  };
  const outevent = ref();
  const timer = ref(null);
  const [isAutoScroll, resetAutoScroll] = useRef(false); // 是否自动滚动
  // 计算速率方法
  const getSpeedRate = (distance: number) => {
    const basicRate = 30; // 基础滚动速度
    const growthFactor = 1.1; // 增长因子，可以根据需要调整
    // 限制指数范围
    const exponent = Math.min(Math.max(Math.abs(distance) >> 1, 1), 30);
    return distance < 0 ? basicRate : basicRate * Math.pow(growthFactor, exponent);
  };

  // 计算滚动时行索引
  const getRowIndexByScroll = (scrollOffset: number, maxScrollHeight: any, position: any) => {
    return (
      (Math.abs(position.scrollTop - scrollOffset) / (maxScrollHeight - position.scrollTop)) *
      (visibleData.value.length - 1 - position.rowIndex)
    );
  };
  const getRowIndexByScrollUp = (scrollOffset: number, position: any) => {
    return (Math.abs(position.scrollTop - scrollOffset) / position.scrollTop) * position.rowIndex;
  };
  //鼠标移动事件
  const scrollSelectEnd: any = ref<SelectRow>();
  const clearTime = () => {
    if (timer.value) {
      clearTimeout(timer.value);
      timer.value = null;
    }
  };
  const [dir, resetDir] = useRef<'up' | 'down' | null>(null);
  const windowMousemove = (event: MouseEvent) => {
    if (event.buttons !== 1 || !isSelecting.value) return; //鼠标松开,不执行

    try {
      outevent.value = event; //保存移动事件

      //获取表格元素
      const table = vxeTableRef.value?.$el?.querySelector('.vxe-table--body-wrapper table'); //获取非固定列(和固定列)的table元素
      const tableRect = table?.parentElement?.getBoundingClientRect(); //获取表格元素的边界
      const clientX = outevent.value.clientX;
      const clientY = outevent.value.clientY;
      const maxScrollHeight = table?.parentElement?.scrollHeight - table?.parentElement?.clientHeight; //获取滚动条最大位置
      const maxScrollWidth = table?.parentElement?.scrollWidth - table?.parentElement?.clientWidth; //获取滚动条最大位置

      if (
        !table ||
        !(
          clientX > tableRect.right ||
          clientX < tableRect.left ||
          clientY > tableRect.bottom ||
          clientY < tableRect.top
        )
      ) {
        clearTime(); //清除定时器
        return;
      }

      //如果正在执行选中操作
      if (!timer.value) {
        scrollSelectEnd.value = cloneDeep(selectionEnd.value);

        const timeoutTask = () => {
          timer.value = setTimeout(() => {
            //开启循环定时器
            if (isSelecting.value) {
              //判断当前是否正在选择
              const tableRect = table.parentElement.getBoundingClientRect(); //获取表格元素的边界
              const clientX = outevent.value.clientX;
              const clientY = outevent.value.clientY;
              if (clientY >= tableRect.bottom) {
                //判断鼠标y轴是否超出表格下方,向下滚动
                const vDistance = clientY - tableRect.bottom;
                const vScrollRate = getSpeedRate(vDistance);
                if (table.parentElement.scrollTop < maxScrollHeight) {
                  //如果没到滚动条最大位置,执行滚动
                  dir.value = 'down';
                  isAutoScroll.value = true; //标记为正在自动滚动

                  table.parentElement.scrollTop += vScrollRate; //执行垂直滚动条向下滚动
                  let rowIndex = getRowIndexByScroll(
                    table.parentElement.scrollTop,
                    maxScrollHeight,
                    scrollSelectEnd.value,
                  );
                  if (selectionEnd.value.rowIndex < selectionStart.value.rowIndex) {
                    rowIndex = Math.floor(rowIndex);
                  } else {
                    rowIndex = Math.ceil(rowIndex);
                  }
                  selectByIndex({
                    endColIndex: selectionEnd.value.colIndex,
                    endRowIndex: scrollSelectEnd.value.rowIndex + rowIndex,
                  });
                }
              } else if (clientY <= tableRect.top) {
                //判断鼠标x轴是否超出表格上侧,向上滚动
                if (table.parentElement.scrollTop > 0) {
                  dir.value = 'up';
                  isAutoScroll.value = true; //标记为正在自动滚动

                  const vDistance = tableRect.top - clientY;
                  const vScrollRate = getSpeedRate(vDistance);
                  //如果没到滚动条最大位置,执行滚动
                  //鼠标移出表格，滚动垂直滚动条
                  table.parentElement.scrollTop -= vScrollRate; //执行垂直滚动条向上滚动
                  let rowIndex = getRowIndexByScrollUp(table.parentElement.scrollTop, scrollSelectEnd.value);
                  if (selectionEnd.value.rowIndex < selectionStart.value.rowIndex) {
                    rowIndex = Math.ceil(rowIndex);
                  } else {
                    rowIndex = Math.floor(rowIndex);
                  }
                  selectByIndex({
                    endColIndex: selectionEnd.value.colIndex,
                    endRowIndex: Math.max(scrollSelectEnd.value.rowIndex - rowIndex, 0),
                  });
                }
              }
              if (clientX >= tableRect.right) {
                //判断鼠标x轴是否超出表格右侧,向右滚动
                if (table.parentElement.scrollLeft < maxScrollWidth) {
                  //如果没到滚动条最大位置,执行滚动
                  const hDistance = clientX - tableRect.right;

                  const hScrollRate = getSpeedRate(hDistance);

                  table.parentElement.scrollLeft += hScrollRate; //执行水平滚动条向右滚动
                }
              } else if (clientX <= tableRect.left) {
                //判断鼠标x轴是否超出表格左侧,向左滚动
                if (table.parentElement.scrollLeft > 0) {
                  //如果没到滚动条最大位置,执行滚动
                  const hDistance = tableRect.left - clientX;
                  const hScrollRate = getSpeedRate(hDistance);
                  //鼠标移出表格，滚动水平滚动条
                  table.parentElement.scrollLeft -= hScrollRate; //执行水平滚动条向左滚动
                }
              }
              timeoutTask();
            } else {
              resetAutoScroll();
              clearTime(); //清除定时器
            }
          }, 60); //这里设置滑动速度
        };
        timeoutTask();
      }
    } catch (error) {
      isSelecting.value = false;
      resetAutoScroll();
      resetDir();
      clearTime();
    }
  };
  let throttleMousemove = throttle(windowMousemove, 200);

  // 矫正滚动计算误差行索引
  const checkedScrollRowIndex = (dir: 'up' | 'down' | null) => {
    const tableRect = selectionStart.value.bodyWrapperRect;
    // 获取表格主体区域
    const bodyWrapper = vxeTableRef.value.$el.querySelector('.vxe-table--body-wrapper');
    if (!bodyWrapper) return null;

    // 获取所有可见行
    const visibleRows = bodyWrapper.querySelectorAll('.vxe-body--row');
    if (!visibleRows.length) return null;
    // 获取当前行的索引
    let endRowIndex = -1;

    // 如果当前累计高度超过鼠标位置，则找到目标行
    if (dir === 'up') {
      if (scrollSatus.value.virtualY) {
        endRowIndex = visibleData.value.findIndex((row: any) => {
          return row[keyField.value] == tableData.value.tableData[0]?.[keyField.value];
        });
        endRowIndex > 0 && endRowIndex++;
      } else {
        for (let i = visibleRows.length - 1; i >= 0; i--) {
          const row = visibleRows[i];

          const top = row?.getBoundingClientRect().top;

          if (top <= tableRect.top) {
            endRowIndex = visibleData.value.findIndex(
              (_row: any) => _row[keyField.value] === row.getAttribute('rowid'),
            );
            break;
          }
        }
      }
      if (endRowIndex >= 0) {
        selectByIndex({
          endColIndex: selectionEnd.value.colIndex,
          endRowIndex,
        });
      }
    } else if (dir === 'down') {
      if (scrollSatus.value.virtualY) {
        endRowIndex = visibleData.value.findIndex((row: any) => {
          return (
            row[keyField.value] == tableData.value.tableData[tableData.value.tableData.length - 1]?.[keyField.value]
          );
        });
        endRowIndex < visibleData.value.length - 1 && endRowIndex--;
      } else {
        for (let i = 0; i < visibleRows.length; i++) {
          const row = visibleRows[i];

          const bottom = row.getBoundingClientRect().bottom;
          if (bottom >= tableRect.bottom) {
            endRowIndex = visibleData.value.findIndex(
              (_row: any) => _row[keyField.value] === row?.getAttribute('rowid'),
            );
            break;
          }
        }
      }
      if (endRowIndex >= 0) {
        selectByIndex({
          endColIndex: selectionEnd.value.colIndex,
          endRowIndex,
        });
      }
    }
    resetDir();
  };
  watch(
    () => isAutoScroll.value,
    (val: boolean) => {
      nextTick(() => {
        if (!val) {
          checkedScrollRowIndex(dir.value);
        }
      });
    },
  );
  /**
   *
   * @param cell  获取单元格位置(rowIndex, rowId, rowRect, bodyWrapperRect, scrollTop colIndex, colId)
   * @returns Promise<{ rowIndex: number; rowId: string; rowRect: DOMRect; bodyWrapperRect: DOMRect; scrollTop: number; colIndex: number; colId: string; } | null>
   */

  const getCellPosition = async (cell: any): Promise<SelectRow> => {
    while (cell.tagName !== 'TD') {
      //将cell指向TD元素
      cell = cell.parentElement;
    }
    const colspan = cell.getAttribute('colspan'); //获取colspan属性
    const rowspan = cell.getAttribute('rowspan'); //获取rowspan属性
    const span = { colspan: colspan ? parseInt(colspan) - 1 : 0, rowspan: rowspan ? parseInt(rowspan) - 1 : 0 };
    const colId = cell.getAttribute('colid');

    const rowId = cell.parentElement?.getAttribute('rowid');
    if (!colId || !rowId) return Promise.reject(null);
    let column = null;
    const colIndex = visibleColumn.value.findIndex((col: { id: any; type: any }) => {
      //返回colid相等的visibleColumn全量表头列的索引
      column = col;
      return col.id == colId;
    });
    if (colIndex < 0) return Promise.reject(null);
    const rowRect = cell?.getBoundingClientRect();
    const rowIndex = visibleData.value.findIndex((row: any) => {
      //返回rowid相等的visibleData全量表体数据
      return row[keyField.value] == rowId; //返回rowid相等的visibleData全量表体数据的索引
    });

    if (rowIndex < 0) return Promise.reject(null);
    const bodyWrapper = vxeTableRef.value?.$el?.querySelector('.vxe-table--main-wrapper .vxe-table--body-wrapper');
    const bodyWrapperRect = bodyWrapper.getBoundingClientRect(); //获取top位置
    const scrollTop = bodyWrapper.scrollTop;
    return Promise.resolve({
      rowIndex,
      rowId,
      rowRect,
      bodyWrapperRect,
      scrollTop,
      colIndex,
      colId,
      span,
      column,
      expandHeight: null,
    });
  };
  // 区域位置
  const areaPosition = ref({
    left: 0,
    top: 0,
    right: 0,
    width: 0,
    height: 0,
  });
  //设置框打开
  const setSelectedCellArea = async () => {
    try {
      // 设置位置
      areaPosition.value = getAreaBoxPosition(selectionStart.value, selectionEnd.value);
      //显示范围框
      openAreaBox();
    } catch (error) {}
  };
  // 对位置按从上到下进行排列
  const getOrderPosition = (a: SelectRow, b: SelectRow) => {
    if (a.rowIndex < 0 || b.rowIndex < 0) return [a, b];
    a = cloneDeep(a);
    b = cloneDeep(b);
    if (a.rowIndex <= b.rowIndex) {
      return [a, b];
    } else {
      return [b, a];
    }
  };
  const getColRowIndexRange = (start: SelectRow, end: SelectRow) => {
    const sColIndex = start.colIndex;
    const sColIndexSpan = start.colIndex + start.span?.colspan;
    const sRowIndex = start.rowIndex;
    const sRowIndexSpan = start.rowIndex + start.span?.rowspan;

    const eColIndex = end.colIndex;
    const eRowIndex = end.rowIndex;
    const eRowIndexSpan = end.rowIndex + end.span?.rowspan;
    const eColIndexSpan = end.colIndex + end.span?.colspan;
    return {
      startColIndex: Math.min(sColIndex, sColIndexSpan, eColIndex, eColIndexSpan),
      startRowIndex: Math.min(sRowIndex, sRowIndexSpan, eRowIndex, eRowIndexSpan),
      endColIndex: Math.max(sColIndex, sColIndexSpan, eColIndex, eColIndexSpan),
      endRowIndex: Math.max(sRowIndex, sRowIndexSpan, eRowIndex, eRowIndexSpan),
    };
  };
  //根据开始位置和结束位置的索引计算框的width,height,left,top(左侧固定列和正常区域和右侧固定列使用)
  const getAreaBoxPosition = (selectStart: SelectRow, selectEnd: SelectRow) => {
    const [start, end] = getOrderPosition(selectStart, selectEnd);
    const {
      startColIndex,
      startRowIndex,
      endColIndex,
      endRowIndex: endRowInd,
    } = getColRowIndexRange(selectStart, selectEnd);
    const startColumnIndex = startColIndex; //开始列索引
    let endColumnIndex = endColIndex;
    let endRowIndex = endRowInd;
    if (startColumnIndex < 0 || endColumnIndex < 0 || startRowIndex < 0 || endRowIndex < 0) return;
    const maxColumnIndex = visibleColumn.value.length - 1; //最大列索引
    const maxRowIndex = visibleData.value.length - 1; //最大行索引
    if (endColumnIndex > maxColumnIndex) {
      //到最后一列,指向最后一列
      endColumnIndex = maxColumnIndex;
    }
    if (endRowIndex > maxRowIndex) {
      //到最后一行,指向最后一行
      endRowIndex = maxRowIndex;
    }
    let width = 0,
      height = 0,
      left = 0,
      top = 0,
      right = 0;
    visibleColumn.value.forEach((col: { renderWidth: number }, index: number) => {
      if (startColumnIndex <= endColumnIndex) {
        //开始列索引小于结束列索引,即从左往右选择
        if (index < startColumnIndex) {
          left += col.renderWidth; //距离表格整体左侧边框距离
        }
        if (index > endColumnIndex) {
          //数据索引大于结束列,这里获取距离后面数据的宽度
          right += col.renderWidth; //距离表格整体右侧边框距离,加上当前列
        }
        if (startColumnIndex <= index && index <= endColumnIndex) {
          //开始列索引大于数据索引 和 结束列索引小于数据索引,这里获取选中区域的宽度
          width += col.renderWidth; //选中区域的宽度
        }
      } else {
        //从右往左选择
        if (index < endColumnIndex) {
          left += col.renderWidth; //距离表格整体左侧边框距离
        }
        if (index > startColumnIndex) {
          //数据索引大于开始列,这里获取距离后面数据的宽度
          right += col.renderWidth; //距离表格整体右侧边框距离,加上当前列
        }
        if (startColumnIndex >= index && index >= endColumnIndex) {
          //开始列索引大于数据索引 和 结束列索引小于数据索引,这里获取选中区域的宽度
          width += col.renderWidth; //选中区域的宽度
        }
      }
    });
    if (scrollSatus.value.virtualY) {
      height = (endRowIndex - startRowIndex + 1) * rowHeight.value;
      top = startRowIndex * rowHeight.value; //距离表格整体顶部边框距离
    } else {
      top =
        (start.rowRect.top ?? 0) -
        (start.bodyWrapperRect?.top ?? 0) +
        start.scrollTop -
        (selectEnd.expandHeight?.topHeight ?? 0); //距离表格整体顶部边框距离

      height =
        Math.max(end.rowRect.bottom, start.rowRect.bottom) +
        end.scrollTop -
        (start.rowRect.top + start.scrollTop) -
        (selectEnd.expandHeight?.height ?? 0);
    }

    return { width, height, left, top, right };
  };

  //显示范围框
  const openAreaBox = () => {
    const fn = (el: any) => {
      if (el) {
        el.style.display = 'block';
        isAreaBoxVisible.value = true;
      }
    };
    let element = vxeTableRef.value?.$el?.querySelector(
      '.vxe-table--main-wrapper .vxe-table--body-wrapper .vxe-table--cell-area',
    );
    fn(element);
    element = vxeTableRef.value?.$el?.querySelector(
      '.vxe-table--fixed-wrapper .vxe-table--fixed-left-wrapper .vxe-table--body-wrapper .vxe-table--cell-area',
    );
    fn(element);
    element = vxeTableRef.value?.$el?.querySelector(
      '.vxe-table--fixed-wrapper .vxe-table--fixed-right-wrapper .vxe-table--body-wrapper .vxe-table--cell-area',
    );
    fn(element);
  };

  //表格外销毁范围框
  const tableOutDestroyAreaBox = (event: MouseEvent) => {
    const element = vxeTableRef.value?.$el?.querySelector('.vxe-table--render-wrapper');

    if (
      event.clientX < element?.getBoundingClientRect().left ||
      event.clientX > element?.getBoundingClientRect().right ||
      event.clientY < element?.getBoundingClientRect().top ||
      event.clientY > element?.getBoundingClientRect().bottom
    ) {
      destroyAll();
    }
  };
  // 在框选的过程中，收集type=expand的列

  //销毁范围框
  const isAreaBoxVisible = ref(false);

  const cellAreaStyle = computed(() => {
    let { left = 0, top = 0, right = 0, width = 0, height = 0 }: any = areaPosition.value ?? {};

    left = left + 'px';
    top = top + (areaExpandHeight.value?.topHeight ?? 0) + 'px';
    right = right + 'px';
    width = width + 'px';
    height = height + (areaExpandHeight.value?.height ?? 0) + 'px';
    const display = isAreaBoxVisible.value ? 'block' : 'none';
    return {
      left: { display, left, top, width, height },
      right: { display, top, right, width, height },
    };
  });
  // 是否复制
  const copiedArea = ref(false);
  // 复制开始位置和结束位置
  const copiedAreaPosition = ref({
    left: 0,
    top: 0,
    right: 0,
    width: 0,
    height: 0,
  });
  // 复制后边框样式
  const copiedAreaStyle = computed(() => {
    let { left = 0, top = 0, right = 0, width = 0, height = 0 }: any = copiedAreaPosition.value ?? {};
    left = left + 'px';
    top = (copiedExpandHeight.value?.topHeight ?? 0) + top + 'px';
    right = right + 'px';
    width = width + 'px';
    height = height + (copiedExpandHeight.value?.height ?? 0) + 'px';
    const display = copiedArea.value ? 'block' : 'none';
    return {
      left: { display, left, top, width, height },
      right: { display, top, right, width, height },
    };
  });
  const destroyAreaBox = () => {
    resetStart();
    resetEnd();
    isAreaBoxVisible.value = false;
    // 清除表头点击复制列
    copyColumns.clear();
    destroyMenu();
  };
  //销毁右键菜单
  const destroyMenu = () => {
    contextMenuAreaStyle.value.display = 'none';
  };
  // 窗口变化时销毁范围框，若出现滚动条，重新绑定左右固定列的事件
  const handleResize = () => {
    bindFixedEvent();
    nextTick(() => {
      update();
    });
  };
  // 窗口变化防抖
  let debounceHandleResize = debounce(handleResize, 400);

  // 销毁复制区域后区域框
  const destroyCopiedAreaBox = () => {
    resetCopiedStart();
    resetCopiedEnd();
    copiedArea.value = false;
  };
  const destroyAll = () => {
    destroyAreaBox();
    destroyCopiedAreaBox();
  };
  // 设置复制后范围区域位置
  const setCopiedArea = () => {
    copiedSelectionStart.value = cloneDeep(selectionStart.value);
    copiedSelectionEnd.value = cloneDeep(selectionEnd.value);
    copiedAreaPosition.value = getAreaBoxPosition(copiedSelectionStart.value, copiedSelectionEnd.value);
    selectionEnd.value.expandHeight = cloneDeep(areaExpandHeight.value);
    copiedArea.value = true;
  };
  // TODO 选取全部
  const getPositionByIndex = (colInd: number, rowInd: number) => {
    let rowId = visibleData.value?.[rowInd]?.[keyField.value];
    const column: any = visibleColumn.value?.[colInd] ?? {};
    const colId = column.id;

    if (!colId || !rowId) return Promise.reject(null);

    const cIndex = colInd; //列索引指针
    const rIndex = rowInd; //行索引指针
    let cell = vxeTableRef.value?.$el?.querySelector(
      `.vxe-table--body-wrapper .vxe-body--row[rowid="${rowId}"] .vxe-body--column[colid="${colId}"]`,
    );
    if (scrollSatus.value.virtualY) {
      rowId = tableData.value.tableData?.[0]?.[keyField.value];
      cell = vxeTableRef.value?.$el?.querySelector(
        `.vxe-table--body-wrapper .vxe-body--row[rowid="${rowId}"] .vxe-body--column[colid="${colId}"]`,
      );
      // while (!cell && cIndex > 0) {
      //   while (!cell && rIndex > 0) {
      //     rowId = visibleData.value?.[--rIndex]?.[keyField.value];
      //     cell = vxeTableRef.value?.$el?.querySelector(
      //       `.vxe-table--body-wrapper .vxe-body--row[rowid="${rowId}"] >.vxe-body--column[colid="${visibleColumn.value?.[cIndex]?.id}"]`,
      //     );
      //   }
      // }
    } else {
      // 查找td
      let _cIndex = cIndex;
      let _rIndex = rIndex;
      while (!cell && _cIndex >= 0) {
        while (!cell && _rIndex >= 0) {
          rowId = visibleData.value?.[--_rIndex]?.[keyField.value];
          cell = vxeTableRef.value?.$el?.querySelector(
            `.vxe-table--body-wrapper .vxe-body--row[rowid="${rowId}"] >.vxe-body--column[colid="${visibleColumn.value?.[_cIndex]?.id}"]`,
          );
          if (cell) {
            const rowspan = cell?.getAttribute('rowspan') ?? 0; //获取rowspan属性
            if (rowInd - _rIndex + 1 !== +rowspan) {
              cell = null;
              _rIndex = rIndex;
            }
            break;
          }
        }
        if (!cell) {
          _rIndex = rIndex;
          rowId = visibleData.value?.[rowInd]?.[keyField.value];
          cell = vxeTableRef.value?.$el?.querySelector(
            `.vxe-table--body-wrapper .vxe-body--row[rowid="${rowId}"] >.vxe-body--column[colid="${
              visibleColumn.value?.[--_cIndex]?.id
            }"]`,
          );
        }
      }
    }

    // const colspan = cell?.getAttribute('colspan'); //获取colspan属性
    // const rowspan = cell?.getAttribute('rowspan'); //获取rowspan属性
    const span = { colspan: 0, rowspan: 0 };
    const rowRect = cell?.getBoundingClientRect() ?? {};
    const bodyWrapper = vxeTableRef.value?.$el?.querySelector('.vxe-table--main-wrapper .vxe-table--body-wrapper');
    const bodyWrapperRect = bodyWrapper.getBoundingClientRect(); //获取top位置
    const scrollTop = bodyWrapper.scrollTop;
    return Promise.resolve({
      rowIndex: rIndex,
      rowId,
      rowRect,
      bodyWrapperRect,
      scrollTop,
      colIndex: cIndex,
      colId,
      span,
      column,
      expandHeight: null,
    });
  };
  const selectByIndex = async ({
    startColIndex,
    startRowIndex,
    endColIndex,
    endRowIndex,
  }: {
    startColIndex?: number;
    startRowIndex?: number;
    endColIndex?: number;
    endRowIndex?: number;
  }) => {
    const isGetStart = startColIndex !== null && startRowIndex !== null && startColIndex >= 0 && startRowIndex >= 0;
    const isGetEnd = endColIndex !== null && endRowIndex !== null && endColIndex >= 0 && endRowIndex >= 0;

    if (isGetStart) {
      startColIndex = Math.min(visibleColumn.value.length - 1, startColIndex);
      startRowIndex = Math.min(visibleData.value.length - 1, startRowIndex);
      selectionStart.value = await getPositionByIndex(startColIndex, startRowIndex);
    }
    if (isGetEnd) {
      endColIndex = Math.min(visibleColumn.value.length - 1, endColIndex);
      endRowIndex = Math.min(visibleData.value.length - 1, endRowIndex);
      selectionEnd.value = await getPositionByIndex(endColIndex, endRowIndex);
      selectionEnd.value.expandHeight = cloneDeep(areaExpandHeight.value);
    }
    if (isGetStart || isGetEnd) {
      isAreaBoxVisible.value = true;
      await update();
    } else {
      error('Invalid start and end index');
    }
  };
  // 表头点击选择列
  const copyColumns = reactive(new Map());
  const handleHeaderClick = async (column: number | number[], callback?: () => void) => {
    let startCol = 0,
      endCol = 0;
    isChecked.value = false;
    if (Array.isArray(column)) {
      startCol = Math.min(...column);
      endCol = Math.max(...column);
      await selectByIndex({
        startColIndex: startCol,
        startRowIndex: 0,
        endColIndex: endCol,
        endRowIndex: visibleData?.value?.length - 1,
      });
    } else {
      startCol = column;
      endCol = column;
      await selectByIndex({
        startColIndex: startCol,
        startRowIndex: 0,
        endColIndex: endCol,
        endRowIndex: visibleData?.value?.length - 1,
      });
      copyColumns.clear();
      copyColumns.set(column, column);
    }
    resetChecked();
    typeof callback === 'function' && callback?.();
  };
  const getFixedColWidth = (dir: 'left' | 'right'): number =>
    visibleColumn.value.filter((col: any) => col.fixed === dir).reduce((pre, cur) => pre + cur.renderWidth, 0);
  // 自动滚动到列边界
  const scrollToCol = (cell: any, column: any) => {
    while (cell.tagName !== 'TH' && cell.tagName !== 'TD') {
      //将cell指向TH、TD元素
      cell = cell.parentElement;
    }
    const rect = cell.getBoundingClientRect();

    const tableWrapper = vxeTableRef.value?.$el?.querySelector('.vxe-table--body-wrapper'); //获取非固定列(和固定列)的table元素
    const bodyWrapperRect = tableWrapper?.getBoundingClientRect(); //获取表格元素的边界
    if (!tableWrapper || column.fixed) return;
    const fixedRightWidth = getFixedColWidth('right'); // 右侧固定列宽度
    const fixedLeftWidth = getFixedColWidth('left'); // 左侧固定列宽度
    const scrollWidth = tableWrapper?.offsetWidth - tableWrapper?.clientWidth || 0; //滚动条宽度
    if (bodyWrapperRect.right - rect.right - scrollWidth < fixedRightWidth) {
      vxeTableRef.value?.scrollTo(
        vxeTableRef.value?.getScroll().scrollLeft +
          scrollWidth +
          fixedRightWidth -
          (bodyWrapperRect.right - rect.right),
      );
    } else if (rect.left - bodyWrapperRect.left < fixedLeftWidth) {
      vxeTableRef.value?.scrollTo(
        vxeTableRef.value?.getScroll().scrollLeft - (fixedLeftWidth - (rect.left - bodyWrapperRect.left)),
      );
    }
  };
  // TODO 自动滚动到行边界
  // const scrollToRow = (cell: any) => {
  //   while (cell.tagName !== 'TH' && cell.tagName !== 'TD') {
  //     //将cell指向TH、TD元素
  //     cell = cell.parentElement;
  //   }

  //   const rect = cell.parentElement.getBoundingClientRect();

  //   const tableWrapper = vxeTableRef.value?.$el?.querySelector('.vxe-table--body-wrapper'); //获取非固定列(和固定列)的table元素

  //   const bodyWrapperRect = tableWrapper?.getBoundingClientRect(); //获取表格元素的边界
  //   if (!tableWrapper) return;
  //   const scrollHeight = tableWrapper?.offsetHeight - tableWrapper?.clientHeight || 0; //滚动条宽度

  //   if (bodyWrapperRect.bottom - rect.bottom - scrollHeight < 0) {
  //     vxeTableRef.value?.scrollTo(
  //       vxeTableRef.value?.getScroll().scrollLeft,
  //       vxeTableRef.value?.getScroll().scrollTop + scrollHeight - (bodyWrapperRect.bottom - rect.bottom),
  //     );
  //   } else if (rect.y - bodyWrapperRect.y < 0) {
  //     vxeTableRef.value?.scrollTo(
  //       vxeTableRef.value?.getScroll().scrollLeft,
  //       vxeTableRef.value?.getScroll().scrollTop - (bodyWrapperRect.y - rect.y),
  //     );
  //   }
  // };
  const headerClick = async (e: any, callback?: () => void) => {
    try {
      const { cell, column, _columnIndex } = e ?? {};
      if (isEffect.value && areaCopyConfig.value.header && !e.triggerResizable && _columnIndex >= 0) {
        destroyMenu();
        if (!tableData.value.tableData.length) {
          return Promise.reject();
        }
        if ((e.$event.ctrlKey || e.$event.metaKey) && e.$event.button === 0) {
          copyColumns.set(e._columnIndex, e._columnIndex);
          await handleHeaderClick([...copyColumns.keys()], callback);
        } else if (e.$event.button === 0) {
          await handleHeaderClick(e._columnIndex, callback);
        }
        scrollToCol(cell, column);
      }
    } catch (error) {
      _log('log', error);
    }
  };
  // 全选
  const selectAll = async () => {
    if (tableData.value.tableData.length === 0 || isSelecting.value) return;
    isChecked.value = false;
    await selectByIndex({
      startColIndex: 0,
      startRowIndex: 0,
      endColIndex: visibleColumn?.value?.length - 1,
      endRowIndex: visibleData?.value?.length - 1,
    });
    resetChecked();
  };
  // 监听esc
  const handleEscDown = (event: KeyboardEvent) => {
    const key = event.key || event.keyCode;
    if (key === 'Escape' || key === 27) {
      destroyAll();
    }
  };
  /**                          获取表头     START                         */

  const getLeafCount = (children: any, length = 0) => {
    if (!children?.length) return length;

    const list = [];

    children.forEach((i: any) => {
      if (i.children?.length) {
        // const itemChildren =
        //   i.children?.filter((item: any) => item.visible && fields.value?.includes(item.field)) ?? [];
        list.push(...i.children);
      } else {
        length++;
      }
    });
    return getLeafCount(list, length);
  };
  // 格式化title
  const formatTitle = (children: any, titleList = [], isStop = false) => {
    if (isStop) return titleList;
    const list = [];
    const tList = [];
    isStop = true;
    children.forEach((i: any) => {
      tList.push(i.title ?? '');
      if (i.children?.length) {
        // const itemChildren =
        //   i.children?.filter((item: any) => item.visible && fields.value?.includes(item.field)) ?? [];
        list.push(...i.children);
        const len = getLeafCount(i.children);
        tList.push(...Array(len - 1).fill('\t'));
        isStop = false;
      } else {
        list.push({ title: '\t' });
      }
    });
    titleList.push(tList);
    return formatTitle(list, titleList, isStop);
  };
  const collectColumn = computed(() => vxeTableRef.value?.getTableColumn?.()?.collectColumn ?? []); //未处理的全量表头列
  const removeInvalidNodes = (node: any, fields: Ref<any[]>) => {
    if (!node || typeof node !== 'object') {
      return null;
    }
    // 如果节点的 visible 为 false，直接移除
    if (node.visible === false) {
      return null;
    }

    // 如果节点有子节点，递归处理子节点
    if (node.children && node.children.length > 0) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        const isValidChild = removeInvalidNodes(child, fields);

        // 如果子节点无效，则从父节点中移除
        if (!isValidChild) {
          node.children.splice(i, 1);
        }
      }

      // 如果父节点的子节点数量为0，则移除父节点
      if (node.children.length === 0) {
        delete node.children;
        return null; // 返回 null 表示该节点需要被移除
      }
    } else {
      // 当前节点是叶子节点
      if (!fields.value.includes(node.field)) {
        // 如果 field 不在 fields 中，则移除
        return null;
      }
    }

    return node; // 返回有效的节点
  };
  const fields = computed(() => selectCols.value?.map((item: any) => item.field || item.property) ?? []);
  // 根据 框选选中列头
  const checkTitle = computed(() => {
    const validColumns = removeInvalidNodes(
      {
        children: cloneDeep(collectColumn.value),
        visible: true,
      },
      fields,
    );
    // 根据框选中列头fields,过滤collectColumn生成表头数据
    return validColumns.children.reduce((prv: any[], cur: any) => {
      const titleList = formatTitle([cur]);

      return [...prv, titleList];
    }, []);
  });
  // 生成表头数据
  const genarateTitle = () => {
    // 表头内容
    const headerArr = [];
    // 指针，指针深度
    let startIndex = 0,
      maxIndex = 0;
    while (startIndex <= maxIndex) {
      const innerList = [];
      // 格式化每层title
      for (let index = 0, arr = checkTitle.value, l = arr.length; index < l; index++) {
        if (startIndex === 0 && (arr[index]?.length ?? 0 - 1) > maxIndex) {
          // 获取指针长度
          maxIndex = (arr[index]?.length ?? 0) - 1;
        }
        //若不存在，则为添加与第一个相同长度的数组，并填充\t
        const t: [] = arr[index][startIndex] ?? Array(arr[index]?.[0]?.length ?? 0).fill('\t');
        innerList.push(...t);
      }
      const title = innerList.map(item => (item.indexOf('\t') > -1 ? $t(item ?? '') : $t(item ?? '') + '\t')).join('');
      headerArr.push(title);
      // 扫描内层指针递增
      startIndex++;
    }
    return [headerArr.map(item => item + '\n').join('')];
  };
  /**                          获取表头     END                         */
  const selectedList = ref([]);
  const lastCheckedRows = ref([]); // 缓存初始选中行数据
  const getCheckedList = () => {
    if (!areaCopyConfig.value?.checkbox) return;
    lastCheckedRows.value = vxeTableRef.value?.getCheckboxRecords() ?? [];
  };
  watch(
    () => selectionEnd.value.rowIndex,
    throttle(() => {
      if (
        areaCopyConfig.value?.checkbox &&
        selectionStart.value?.column?.type === 'checkbox' &&
        isAreaBoxVisible.value &&
        isChecked.value
      ) {
        nextTick(async () => {
          let rowStart = selectionStart.value.rowIndex; //获取选中起始行索引
          let rowEnd = selectionEnd.value.rowIndex; //获取选中结束行索引
          if (rowStart < 0 || rowEnd < 0) return;
          if (rowStart > rowEnd) {
            rowStart = rowEnd;
            rowEnd = selectionStart.value.rowIndex;
          }
          let checkedRows = visibleData.value.slice(rowStart, rowEnd + 1) ?? [];
          const checkMethod = vxeTableRef.value?.checkboxConfig?.checkMethod;
          if (checkMethod) {
            checkedRows =
              checkedRows.filter((row: any) => {
                const checkStatus = checkMethod({ row }) ?? true;
                return checkStatus;
              }) ?? [];
          }
          // 比较前一次选中行数据和当前选中行数据的差异，取消不在当前选中行数据的checkbox
          const diffRows = lastCheckedRows.value.filter((row: any) => !checkedRows?.includes(row));
          if (diffRows?.length) {
            await vxeTableRef.value?.setCheckboxRow(diffRows, false);
          }
          await vxeTableRef.value?.setCheckboxRow(checkedRows, true);
          selectedList.value = checkedRows ?? [];
          lastCheckedRows.value = checkedRows ?? [];
        });
      }
    }, 70),
  );
  const selectCols = ref([]);

  const getSelectedData = () => {
    const {
      startColIndex: colStart,
      startRowIndex: rowStart,
      endColIndex: colEnd,
      endRowIndex: rowEnd,
    } = getColRowIndexRange(selectionStart.value, selectionEnd.value);
    selectCols.value =
      visibleColumn.value.filter(({ type }: any, index: number) => {
        //col参数不能改否则会获取不到数据
        //这里修改从右下往左上拖动的数据显示
        if (type === 'checkbox' || type === 'expand') {
          return false;
        }
        if (colStart <= colEnd) {
          return colStart <= index && colEnd >= index;
        } else {
          return colStart >= index && colEnd <= index;
        }
      }) ?? [];

    const selectRows = visibleData.value.slice(rowStart, rowEnd + 1) ?? [];
    const selectRowsList = selectRows.map((currentRow: { [key: string]: any }, index: number) => {
      const str = selectCols.value?.map((item: any) => {
        // value 值
        const val = item.type === 'seq' ? index + 1 : get(currentRow, item.field);

        // 格式化参数
        const formatItem: any = formatOptions.value.find((el: any) => el.keys.some((v: any) => v === item.field));
        // 拼 \t 在excel中为单元格分隔符
        const strVal = `${(formatItem ? formatItem.format(val, { ...currentRow, index }) : val) ?? ''}`;
        return strVal;
      });
      // 拼 \n 在excel中为换行符
      return str.join('\t') + '\n';
    });
    return selectRowsList;
  };
  /*
   *
   * @param  flag 是否复制表头
   **/
  const onClickCopy = async (flag?: boolean) => {
    try {
      const datalist = getSelectedData();
      const text = (flag ? [...genarateTitle(), ...datalist] : datalist).join('');
      await textCopy(text, false);
      setCopiedArea();
      message.success($t('ytDesign_copyCol_copySuccessTips'));
      destroyAreaBox();
      destroyMenu();
    } catch (err) {
      error(err);
      copiedArea.value = false;
      message.warning($t('ytDesign_copyCol_fail'));
    }
  };
  /*
   *
   * @param {*} $event 事件对象
   * @param {*} flag 是否复制表头
   **/
  const copySave = ($event: any, flag = false) => {
    if (isAreaBoxVisible.value) {
      // 显示框还在则可以复制
      $event.preventDefault();
      onClickCopy(flag);
    }
  };
  // 对区域进行扩展
  const handleExpandArea = async ($event: any) => {
    $event.preventDefault();
    if ($event.button === 0) {
      isChecked.value = false;
      const { colIndex, rowIndex } = selectionEnd.value;
      const { colIndex: startColIndex, rowIndex: startRowIndex } = selectionStart.value;
      const sCol = Math.min(colIndex, startColIndex);
      const eCol = Math.max(colIndex, startColIndex);
      const sRow = Math.min(startRowIndex, rowIndex);
      const eRow = Math.max(startRowIndex, rowIndex);
      await selectByIndex({ startColIndex: sCol, startRowIndex: sRow, endColIndex: eCol, endRowIndex: eRow });
      isSelecting.value = true;
      destroyMenu();
    }
  };

  const update = async () => {
    try {
      if (isAreaBoxVisible.value) {
        setSelectedCellArea();
      }
      if (copiedArea.value) {
        copiedAreaPosition.value = getAreaBoxPosition(copiedSelectionStart.value, copiedSelectionEnd.value);
      }
    } catch (error) {
      _log('log', error);
    }
  };
  watch(
    () => visibleColumn.value,
    () => {
      destroyAll();
    },
  );
  const addListener = () => {
    //添加多选列

    nextTick(() => {
      window.addEventListener('resize', debounceHandleResize); // 窗口有变化时销毁范围框
      window.addEventListener('mousedown', tableOutDestroyAreaBox); //给window添加鼠标按下事件,判断是否在表格外,是销毁
      window.addEventListener('mouseup', tbodymouseup); //给window添加鼠标松开事件
      window.addEventListener('keydown', handleEscDown); //给window添加esc键按下事件
      document.addEventListener('mousemove', throttleMousemove); //给window添加鼠标移动事件
      tbody = vxeTableRef.value?.$el?.querySelector('.vxe-table--main-wrapper table tbody'); //获取tbody区域

      if (tbody) {
        tbody.addEventListener('mousedown', tbodymousedown); //给表格中的tbody添加鼠标按下事件
        tbody.addEventListener('mousemove', throttleTbodymousemove); //给表格中的tbody添加鼠标移动事件
        tbody.oncontextmenu = tableCellMenuClick; //添加右键菜单事件
      }

      const bodyWrapper = vxeTableRef.value?.$el?.querySelector('.vxe-table--main-wrapper .vxe-table--body-wrapper'); //获取正常区域的body
      if (bodyWrapper) {
        //注意这里的ref名称，这里是非fixed区域的框的名称
        bodyWrapper.appendChild(cellarea.value); //添加范围框元素
      }
    });
  };

  // 初始化区域框所有元素
  const copyContextMenuStyle =
    'cursor: pointer; z-index: 9999; background-image: linear-gradient(var(--vxe-table-border-color), var(--vxe-table-border-color)); padding: 6px 8px;';
  const btnsStyle =
    'color: #1d4cd2;height: 30px;padding: 4px 0;line-height: 1;border-color: transparent;background: transparent;box-shadow: none;position: relative;display: inline-block;font-weight: 400;white-space: nowrap;text-align: center;border: 1px solid transparent';
  const spanStyle =
    'line-height: 16px;display: inline-block;border-width: 0 0 1px 0;border-color:#1d4cd2;border-style:solid';
  const AreaElement = () => {
    return (
      <div style={{ display: isEffect.value ? 'block' : 'none' }}>
        <div ref={contextMenuArea} style={contextMenuAreaStyle.value}>
          <div
            class="vxe-table-copy-context-menu"
            onContextmenu={$event => $event.preventDefault()}
            onMousedown={$event => $event.stopPropagation()}
            onClick={$event => $event.stopPropagation()}
            style={copyContextMenuStyle}
          >
            {showHeader.value ? (
              <div>
                <span onClick={$event => copySave($event, true)} style={btnsStyle}>
                  <span style={spanStyle}>{$t('ytDesign_areaCopy_copy_header')}</span>
                </span>
              </div>
            ) : null}
            <div>
              <span onClick={$event => copySave($event, false)} style={btnsStyle}>
                <span style={spanStyle}>{$t('ytDesign_areaCopy_copy')}</span>
              </span>
            </div>
            <div>
              <span onClick={selectAll} style={btnsStyle}>
                <span style={spanStyle}>{$t('ytDesign_areaCopy_select_all')}</span>
              </span>
            </div>
          </div>
        </div>
        {/* <!-- 正常区域的框 --> */}
        <div ref={cellarea} class="vxe-table--cell-area">
          <span class="vxe-table--cell-main-area" style={cellAreaStyle.value?.left}>
            <span
              class="vxe-table--cell-main-area-btn"
              style={extensionStyle.value}
              onMousedown={handleExpandArea}
            ></span>
          </span>
          <span class="vxe-table--cell-active-area" style={cellAreaStyle.value?.left}></span>
          <span class="vxe-table--cell-copy-area" style={copiedAreaStyle.value.left}></span>
        </div>
        {/* 左侧fixed区域的框 */}
        <div ref={leftfixedcellarea} class="vxe-table--cell-area">
          <span class="vxe-table--cell-main-area" style={cellAreaStyle.value?.left}>
            <span
              class="vxe-table--cell-main-area-btn"
              style={extensionStyle.value}
              onMousedown={handleExpandArea}
            ></span>
          </span>
          <span class="vxe-table--cell-active-area" style={cellAreaStyle.value?.left}></span>
          <span class="vxe-table--cell-copy-area" style={copiedAreaStyle.value.left}></span>
        </div>
        {/* 右侧fixed区域的框 */}
        <div ref={rightfixedcellarea} class="vxe-table--cell-area">
          <span class="vxe-table--cell-main-area" style={cellAreaStyle.value?.right}>
            <span
              class="vxe-table--cell-main-area-btn"
              style={extensionStyle.value}
              onMousedown={handleExpandArea}
            ></span>
          </span>
          <span class="vxe-table--cell-active-area" style={cellAreaStyle.value?.right}></span>
          <span class="vxe-table--cell-copy-area" style={copiedAreaStyle.value?.right}></span>
        </div>
      </div>
    );
  };
  const wrapper = () => {
    return <AreaElement />;
  };
  const initAreaElement = () => {
    const vm = createVNode(wrapper);
    vm.appContext = getCurrentInstance()?.appContext;
    render(vm, vxeTableRef.value?.$el);
    return vm;
  };
  onMounted(() => {
    watch(
      () => isEffect.value,
      newVal => {
        if (vxeTableRef.value) {
          vxeTableRef.value.$el.style =
            vxeTableRef.value?.$el?.style + (newVal ? ';user-select:none' : ';user-select:auto');
        }
        if (newVal) {
          bindFixedEvent();
        } else {
          destroyAll();
        }
      },
      { immediate: true, flush: 'pre' },
    );
    // 初始化区域框元素
    initAreaElement();
    // 获取表格数据
    addListener();
  });

  // 清除所有监听
  const handleUnmount = () => {
    window.removeEventListener('mousedown', tableOutDestroyAreaBox);
    window.removeEventListener('mouseup', tbodymouseup);
    window.removeEventListener('resize', debounceHandleResize);
    window.removeEventListener('keydown', handleEscDown);
    document.removeEventListener('mousemove', throttleMousemove);
    clearTbodyListener();
    clearLeftTbodyListener();
    clearRightTbodyListener();
    debounceHandleResize = null;
    throttleTbodymousemove = null;
    throttleMousemove = null;
    clearTime();
    expandRows.value.clear();
  };
  onBeforeUnmount(() => {
    handleUnmount();
  });
  return {
    isEffect,
    selectedList, //复选框选中行

    copySave,
    bindFixedEvent,
    update,
    selectAll,
    headerClick,
    selectByIndex,
    destroyAreaBox,
  };
}
const CopyPlugin = {
  install: (app: App, { i18n }) => {
    if (!i18n) {
      app.use(i18n);
    }
  },
};
export default CopyPlugin as typeof useAreaCopy & Plugin;
