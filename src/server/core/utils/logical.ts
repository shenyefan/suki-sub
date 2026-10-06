function AND(...args: any[]) {
  return args.reduce((a, b) => a.map((c: any, i: number) => b[i] && c))
}

function OR(...args: any[]) {
  return args.reduce((a, b) => a.map((c: any, i: number) => b[i] || c))
}

function NOT(array: any[]) {
  return array.map((c) => !c)
}

function FULL(length: number, bool: boolean) {
  return [...Array(length).keys()].map(() => bool)
}

export { AND, OR, NOT, FULL }
