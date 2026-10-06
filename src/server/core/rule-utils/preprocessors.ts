/**
 * 规则预处理器。
 */
function HTML() {
  const name = 'HTML'
  const test = (raw: any) => /^<!DOCTYPE html>/.test(raw)
  // simply discard HTML
  const parse = () => ''
  return { name, test, parse }
}

function ClashProvider() {
  const name = 'Clash Provider'
  const test = (raw: any) => /^payload:/gm.exec(raw)!.index >= 0
  const parse = (raw: any) => {
    return raw.replace('payload:', '').replace(/^\s*-\s*/gm, '')
  }
  return { name, test, parse }
}

export default [HTML(), ClashProvider()]
