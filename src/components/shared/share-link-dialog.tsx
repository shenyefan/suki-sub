import { QRCodeSVG } from 'qrcode.react'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'

import { copyToClipboard, shareUrl } from '#/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

/** 创建分享和卡片入口共用同一份链接与二维码。 */
export function ShareLinkDialog({
  shareId,
  platform,
  onOpenChange,
}: {
  shareId?: string
  platform?: string
  onOpenChange: (open: boolean) => void
}) {
  const link = shareId ? shareUrl(shareId, platform) : ''
  return (
    <Dialog open={Boolean(shareId)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享链接</DialogTitle>
          <DialogDescription>
            复制链接或扫描二维码，将订阅导入客户端。
          </DialogDescription>
        </DialogHeader>
        {link && (
          <>
            <div className="mx-auto max-w-full rounded-md border bg-white p-2">
              <QRCodeSVG
                value={link}
                size={240}
                level="M"
                marginSize={4}
                title="订阅分享二维码"
                className="h-auto max-w-full"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="share-link">分享链接</Label>
              <Input
                id="share-link"
                value={link}
                readOnly
                onFocus={(event) => event.target.select()}
              />
            </div>
            <Button
              onClick={async () => {
                if (await copyToClipboard(link)) toast.success('链接已复制')
                else toast.error('复制失败，请手动复制链接')
              }}
            >
              <Link2 aria-hidden />
              复制分享链接
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
