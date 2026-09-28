import type {PickingList} from './picking-list';
const esc=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function pickingListXml(data:PickingList) {
  const cell=(index:number,value:unknown,style='Cell',down=0,formula='',across=0)=>`<Cell ss:Index="${index}" ss:StyleID="${style}"${down?` ss:MergeDown="${down}"`:''}${across?` ss:MergeAcross="${across}"`:''}${formula?` ss:Formula="${esc(formula)}"`:''}><Data ss:Type="${typeof value==='number'?'Number':'String'}">${esc(value)}</Data></Cell>`;
  const headers=['唛头','品名','材质（HS编码）','包装形式','件数','数量规格/件','总个数','单件净重 KGS','总净重 KGS','单件毛重 KGS','总毛重 KGS','长 cm','宽 cm','高 cm','立方数 m³','总立方 m³','图片','备注'];
  const rows=[`<Row ss:Height="30">${cell(1,`PICKING LIST — ${data.batchNo}`,'Header',0,'',17)}</Row>`,`<Row ss:Height="24">${cell(1,'有客户托盘按品名、规格及实重分行；无客户托盘一行杂货。尺寸单位cm，重量单位kg。','Cell',0,'',17)}</Row>`,`<Row ss:Height="36">${headers.map((h,i)=>cell(i+1,h,'Header')).join('')}</Row>`];
  let totalUnits=0,lineCount=0;
  for(const group of data.groups)for(const [i,r] of group.rows.entries()) {
    const down=group.rows.length-1;const cells:string[]=[];lineCount++;
    if(i===0)cells.push(cell(1,group.mark,'Cell',down));
    cells.push(cell(2,r.name),cell(3,r.hs));
    if(i===0)cells.push(cell(4,group.type,'Cell',down));
    const units=(r.inner??1)*r.count;totalUnits+=units;
    cells.push(cell(5,r.count,'Integer'),cell(6,r.inner===null?'':`${r.inner}*${r.count}`),cell(7,units,'Integer'),cell(8,r.weight??'','Decimal'),cell(9,r.net,'Decimal',0,r.weight===null?'':'=RC[-4]*RC[-1]'),cell(10,r.weight===null?'':r.weight*1.005,'Decimal',0,r.weight===null?'':'=RC[-2]*1.005'),cell(11,r.net*1.005,'Decimal',0,'=RC[-2]*1.005'));
    if(i===0)cells.push(...group.dimensions.map((v,j)=>cell(12+j,v,'Decimal',down)),cell(15,group.volume,'Volume',down,'=RC[-3]*RC[-2]*RC[-1]/1000000'));
    cells.push(cell(16,''),cell(17,''),cell(18,''));
    rows.push(`<Row ss:Height="34">${cells.join('')}</Row>`);
  }
  const last=lineCount+3;
  rows.push(`<Row ss:Height="26">${cell(1,'合计','Header')}${cell(5,data.count,'Header',0,lineCount?`=SUM(R4C5:R${last}C5)`:'')}${cell(7,totalUnits,'Header',0,lineCount?`=SUM(R4C7:R${last}C7)`:'')}${cell(9,data.net,'TotalDecimal',0,lineCount?`=SUM(R4C9:R${last}C9)`:'')}${cell(11,data.net*1.005,'TotalDecimal',0,lineCount?`=SUM(R4C11:R${last}C11)`:'')}${cell(15,data.volume,'TotalVolume',0,lineCount?`=SUM(R4C15:R${last}C15)`:'')}</Row>`);
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  <Style ss:ID="Cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#AFE5E2" ss:Pattern="Solid"/><Borders>${['Top','Bottom','Left','Right'].map(p=>`<Border ss:Position="${p}" ss:LineStyle="Continuous" ss:Weight="1"/>`).join('')}</Borders></Style>
  <Style ss:ID="Header" ss:Parent="Cell"><Font ss:Bold="1"/><Interior ss:Color="#FFC000" ss:Pattern="Solid"/></Style><Style ss:ID="Integer" ss:Parent="Cell"><NumberFormat ss:Format="0"/></Style><Style ss:ID="Decimal" ss:Parent="Cell"><NumberFormat ss:Format="0.000"/></Style><Style ss:ID="Volume" ss:Parent="Cell"><NumberFormat ss:Format="0.000000"/></Style><Style ss:ID="TotalDecimal" ss:Parent="Header"><NumberFormat ss:Format="0.000"/></Style><Style ss:ID="TotalVolume" ss:Parent="Header"><NumberFormat ss:Format="0.000000"/></Style>
  </Styles><Worksheet ss:Name="Picking List"><Table>${[130,210,110,60,50,85,65,80,80,80,80,55,55,55,85,75,65,85].map(w=>`<Column ss:Width="${w}"/>`).join('')}${rows.join('')}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane><DoNotDisplayGridlines/></WorksheetOptions></Worksheet></Workbook>`;
}
export function downloadPickingList(data:PickingList) {
  const url=URL.createObjectURL(new Blob(['\ufeff',pickingListXml(data)],{type:'application/vnd.ms-excel;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='picking list.xls';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
