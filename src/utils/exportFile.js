// 真实按筛选与权限导出：支持标准 CSV 及多工作表合并表头电子表格（SpreadsheetML .xls）

function escapeCsvCell(val) {
  const s = String(val ?? '').replace(/\r?\n/g, ' ')
  return `"${s.replace(/"/g, '""')}"`
}

function escapeXml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1200)
}

export function exportRealCsv(filename, headers, rows) {
  const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(','))
  ]
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, safeName)
}

/**
 * 导出带合并表头、多工作表、起始行列的真电子表格文件（兼容国产 WPS / 永中 / Excel）
 * sheets: [{ name, title, subtitle, startRow, startCol, groups: [{ label, span }], headers: [], rows: [][] }]
 */
export function exportMultiSheetExcel(filename, sheets) {
  const safeName = filename.endsWith('.xls') ? filename : `${filename}.xls`
  const worksheetsXml = sheets.map((sh) => {
    const padCols = Math.max(0, (sh.startCol || 1) - 1)
    const padRows = Math.max(0, (sh.startRow || 1) - 1)
    const totalCols = sh.headers.length
    const emptyCells = padCols ? `<Cell ss:MergeAcross="${padCols - 1}"><Data ss:Type="String"></Data></Cell>` : ''
    let rowsXml = ''

    for (let i = 0; i < padRows; i++) {
      rowsXml += '<Row></Row>'
    }
    if (sh.title) {
      rowsXml += `<Row ss:Height="28">${padCols ? `<Cell ss:Index="${padCols + 1}"` : '<Cell'} ss:MergeAcross="${Math.max(0, totalCols - 1)}" ss:StyleID="Title"><Data ss:Type="String">${escapeXml(sh.title)}</Data></Cell></Row>`
    }
    if (sh.subtitle) {
      rowsXml += `<Row ss:Height="20">${padCols ? `<Cell ss:Index="${padCols + 1}"` : '<Cell'} ss:MergeAcross="${Math.max(0, totalCols - 1)}" ss:StyleID="Sub"><Data ss:Type="String">${escapeXml(sh.subtitle)}</Data></Cell></Row>`
    }
    if (sh.groups && sh.groups.length) {
      let colCursor = padCols + 1
      const groupCells = sh.groups.map((g) => {
        const span = Math.max(1, g.span)
        const xml = `<Cell ss:Index="${colCursor}" ss:MergeAcross="${span - 1}" ss:StyleID="GroupHead"><Data ss:Type="String">${escapeXml(g.label)}</Data></Cell>`
        colCursor += span
        return xml
      }).join('')
      rowsXml += `<Row ss:Height="24">${groupCells}</Row>`
    }
    const headerCells = sh.headers.map((h, idx) =>
      `<Cell ${idx === 0 && padCols ? `ss:Index="${padCols + 1}"` : ''} ss:StyleID="Head"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`
    ).join('')
    rowsXml += `<Row ss:Height="22">${headerCells}</Row>`

    sh.rows.forEach((r) => {
      const cells = r.map((cell, idx) => {
        const isNum = typeof cell === 'number' && Number.isFinite(cell)
        return `<Cell ${idx === 0 && padCols ? `ss:Index="${padCols + 1}"` : ''} ss:StyleID="Cell"><Data ss:Type="${isNum ? 'Number' : 'String'}">${escapeXml(cell)}</Data></Cell>`
      }).join('')
      rowsXml += `<Row ss:Height="20">${cells}</Row>`
    })

    return `<Worksheet ss:Name="${escapeXml(sh.name.slice(0, 30))}"><Table>${rowsXml}</Table></Worksheet>`
  }).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14" ss:Color="#10213A"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
    <Style ss:ID="Sub"><Font ss:Size="10" ss:Color="#55657D"/><Alignment ss:Horizontal="Left" ss:Vertical="Center"/></Style>
    <Style ss:ID="GroupHead"><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="#1A4B8C" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/></Borders></Style>
    <Style ss:ID="Head"><Font ss:Bold="1" ss:Size="10" ss:Color="#10213A"/><Interior ss:Color="#E9F0FB" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#C5D0DF"/></Borders></Style>
    <Style ss:ID="Cell"><Font ss:Size="10" ss:Color="#111C2D"/><Alignment ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E6ECF4"/></Borders></Style>
  </Styles>
  ${worksheetsXml}
</Workbook>`

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  triggerDownload(blob, safeName)
}
