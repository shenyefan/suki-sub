export interface DisplayResource {
  name?: string
  displayName?: string
  icon?: string
  img?: string
  isIconColor?: boolean
  iconFit?: string
}

export function resourceLabel(
  resource: DisplayResource | undefined,
  fallback = '',
): string {
  return resource?.displayName?.trim() || resource?.name?.trim() || fallback
}
