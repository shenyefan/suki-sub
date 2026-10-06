/**
 * 可拖动排序列表(dnd-kit):拖动手柄 + 完整键盘支持
 * (手柄聚焦后空格拾起、方向键移动、再按空格放下)。
 * 用法:SortableList 内渲染 SortableRow,行内容里放 SortHandle。
 */
import { createContext, useContext, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

import { cn } from '#/lib/utils'

const SortablePropsContext = createContext<ReturnType<
  typeof useSortable
> | null>(null)

export function SortableList<T>({
  items,
  getId,
  getLabel = getId,
  onReorder,
  children,
  className,
  layout = 'list',
}: {
  items: T[]
  getId: (item: T) => string
  getLabel?: (item: T) => string
  onReorder: (next: T[]) => void
  /** 渲染每个条目(含 SortableRow / SortableCard) */
  children: (item: T, index: number) => React.ReactNode
  className?: string
  /** grid 用于卡片网格,rect 碰撞策略更准 */
  layout?: 'list' | 'grid'
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => getId(i) === active.id)
    const newIndex = items.findIndex((i) => getId(i) === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onReorder(arrayMove(items, oldIndex, newIndex))
  }
  const activeItem = items.find((item) => getId(item) === activeId)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={items.map(getId)}
        strategy={
          layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy
        }
      >
        <ul className={className}>
          {items.map((item, i) => children(item, i))}
        </ul>
      </SortableContext>
      <span className="sr-only" aria-live="polite">
        {activeId
          ? `正在排序:${activeItem ? getLabel(activeItem) : activeId},方向键移动,空格放下`
          : ''}
      </span>
    </DndContext>
  )
}

export function SortableRow({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const sortable = useSortable({ id })
  return (
    <SortablePropsContext value={sortable}>
      <li
        ref={sortable.setNodeRef}
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        }}
        className={cn(sortable.isDragging && 'z-10 opacity-80', className)}
      >
        {children}
      </li>
    </SortablePropsContext>
  )
}

/** 拖动手柄:放在 SortableRow 内容中 */
export function SortHandle() {
  const ctx = useContext(SortablePropsContext)
  if (!ctx) return null
  return (
    <button
      type="button"
      {...ctx.attributes}
      {...ctx.listeners}
      aria-label="拖动排序(聚焦后空格拾起,方向键移动)"
      className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  )
}
