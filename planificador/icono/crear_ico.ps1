# Genera icono.ico (varios tamaños) a partir del logo de Time Capture (logo_original.png,
# descargado de https://tc.eficacia.com.co/assets/icon-80.png).
# Tamaños pequeños: solo el globo del logo; tamaños grandes: el logo completo.
Add-Type -AssemblyName System.Drawing
$base = $PSScriptRoot
$logo = [System.Drawing.Image]::FromFile((Join-Path $base "logo_original.png"))
$globo = New-Object System.Drawing.Rectangle 56, 32, 120, 92    # zona del óvalo (sin la palabra) en la imagen de 225x225
$completo = New-Object System.Drawing.Rectangle 0, 0, $logo.Width, $logo.Height

$tamanos = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($t in $tamanos) {
    $bmp = New-Object System.Drawing.Bitmap $t, $t
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.Clear([System.Drawing.Color]::White)
    $origen = if ($t -le 48) { $globo } else { $completo }
    # Se centra conservando la proporción (el óvalo es más ancho que alto)
    $alto = [int][Math]::Round($t * $origen.Height / $origen.Width)
    $destino = New-Object System.Drawing.Rectangle 0, ([int](($t - $alto) / 2)), $t, $alto
    $g.DrawImage($logo, $destino, $origen, [System.Drawing.GraphicsUnit]::Pixel)
    if ($t -eq 256) {
        # 256 px va como PNG (así lo admite Windows); se guarda también como logo.png para la interfaz
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Save((Join-Path $base "logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $pngs += , @($t, $ms.ToArray())
    } else {
        # Tamaños pequeños como mapa de bits de 32 bits (BMP sin cabecera de archivo), legible por todo Windows
        if ($t -eq 32) { $bmp.Save((Join-Path $base "globo.png"), [System.Drawing.Imaging.ImageFormat]::Png) }
        $ms = New-Object System.IO.MemoryStream
        $bw = New-Object System.IO.BinaryWriter $ms
        $bw.Write([UInt32]40); $bw.Write([Int32]$t); $bw.Write([Int32]($t * 2))
        $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]0)
        $bw.Write([UInt32]($t * $t * 4)); $bw.Write([Int32]0); $bw.Write([Int32]0); $bw.Write([UInt32]0); $bw.Write([UInt32]0)
        for ($yy = $t - 1; $yy -ge 0; $yy--) {          # filas de abajo hacia arriba
            for ($xx = 0; $xx -lt $t; $xx++) {
                $c = $bmp.GetPixel($xx, $yy)
                $bw.Write([Byte]$c.B); $bw.Write([Byte]$c.G); $bw.Write([Byte]$c.R); $bw.Write([Byte]255)
            }
        }
        $filaMascara = [int]([Math]::Ceiling($t / 32) * 4)       # máscara AND vacía (todo visible)
        $bw.Write((New-Object byte[] ($filaMascara * $t)))
        $bw.Flush()
        $pngs += , @($t, $ms.ToArray())
    }
    $g.Dispose(); $bmp.Dispose()
}
$logo.Dispose()

# Archivo .ico con las imágenes PNG embebidas (formato admitido desde Windows Vista)
$salida = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $salida
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$pngs.Count)
$offset = 6 + 16 * $pngs.Count
foreach ($p in $pngs) {
    $t = $p[0]; $datos = $p[1]
    $lado = if ($t -ge 256) { 0 } else { $t }
    $w.Write([Byte]$lado); $w.Write([Byte]$lado); $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$datos.Length); $w.Write([UInt32]$offset)
    $offset += $datos.Length
}
foreach ($p in $pngs) { $w.Write([byte[]]$p[1]) }
$w.Flush()
[IO.File]::WriteAllBytes((Join-Path $base "icono.ico"), $salida.ToArray())
"icono.ico creado con $($pngs.Count) tamaños"
