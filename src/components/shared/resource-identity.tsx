import { CardIcon } from './resource-card'
import { resourceLabel } from '#/lib/resource-display'
import type { DisplayResource } from '#/lib/resource-display'

export function ResourceIdentity({
  resource,
  name,
}: {
  resource?: DisplayResource
  name: string
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <CardIcon
        src={resource?.icon || resource?.img}
        name={resourceLabel(resource, name)}
        color={resource?.isIconColor}
        fit={resource?.iconFit}
        className="size-5 border-0 text-xs"
      />
      <span className="truncate">{resourceLabel(resource, name)}</span>
    </span>
  )
}
