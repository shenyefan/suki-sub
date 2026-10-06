export function findByName(list: any[], name: string, field = 'name') {
  return list.find((item: any) => item[field] === name)
}

export function findIndexByName(list: any[], name: string, field = 'name') {
  return list.findIndex((item: any) => item[field] === name)
}

export function deleteByName(list: any[], name: string, field = 'name') {
  const idx = findIndexByName(list, name, field)
  list.splice(idx, 1)
}

export function updateByName(
  list: any[],
  name: string,
  newItem: any,
  field = 'name',
) {
  const idx = findIndexByName(list, name, field)
  list[idx] = newItem
}

export function insertByPosition(
  list: any[],
  item: any,
  position: string = 'bottom',
) {
  if (position === 'top') {
    list.unshift(item)
    return
  }

  list.push(item)
}
