# FIX: a single uniform scale preserves barcode geometry; rotate only when it fits better.
function Get-LabelFit([double]$ImageWidth,[double]$ImageHeight,[double]$X,[double]$Y,[double]$Width,[double]$Height) {
  if ($ImageWidth -le 0 -or $ImageHeight -le 0 -or $Width -le 0 -or $Height -le 0) { throw 'Invalid printable area.' }
  $scale = [Math]::Min($Width / $ImageWidth, $Height / $ImageHeight)
  $turned = [Math]::Min($Width / $ImageHeight, $Height / $ImageWidth)
  $rotate = $turned -gt ($scale + 0.000001)
  if ($rotate) { $w=$ImageHeight*$turned; $h=$ImageWidth*$turned } else { $w=$ImageWidth*$scale; $h=$ImageHeight*$scale }
  return @{X=$X+($Width-$w)/2;Y=$Y+($Height-$h)/2;Width=$w;Height=$h;Rotate=$rotate}
}
function Draw-FittedLabel($Image,$EventArgs,[double]$PaperWidth,[double]$PaperHeight) {
  $area=$EventArgs.PageSettings.PrintableArea
  $left=[Math]::Max(0,$area.Left); $top=[Math]::Max(0,$area.Top)
  $width=[Math]::Min($PaperWidth,$area.Right)-$left
  $height=[Math]::Min($PaperHeight,$area.Bottom)-$top
  $fit=Get-LabelFit $Image.Width $Image.Height $left $top $width $height
  $copy=$null; $state=$EventArgs.Graphics.Save()
  try {
    $EventArgs.Graphics.PageUnit=[Drawing.GraphicsUnit]::Display
    # GDI origin is at the hardware margin when OriginAtMargins is false.
    $EventArgs.Graphics.TranslateTransform(-$EventArgs.PageSettings.HardMarginX,-$EventArgs.PageSettings.HardMarginY)
    $source=$Image
    if($fit.Rotate){$copy=$Image.Clone();$copy.RotateFlip([Drawing.RotateFlipType]::Rotate90FlipNone);$source=$copy}
    $EventArgs.Graphics.DrawImage($source,[Drawing.RectangleF]::new($fit.X,$fit.Y,$fit.Width,$fit.Height))
  } finally { $EventArgs.Graphics.Restore($state); if($copy){$copy.Dispose()} }
}
