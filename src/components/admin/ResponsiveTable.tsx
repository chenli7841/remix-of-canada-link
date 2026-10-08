import { Children, Fragment, cloneElement, isValidElement, useEffect, useState, type ReactNode, type ReactElement, type ComponentProps } from 'react';
import './ResponsiveTable.css';

export function useNarrowAdminLayout() {
  const [narrow,setNarrow]=useState(false);
  useEffect(()=>{const media=window.matchMedia('(max-width: 1279px)');const update=()=>setNarrow(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
  return narrow;
}
function text(node:ReactNode):string {
  return Children.toArray(node).map(child=>typeof child==='string'||typeof child==='number'?String(child):isValidElement<{children?:ReactNode}>(child)?text(child.props.children):'').join(' ').trim();
}
function mapTree(node:ReactNode, visit:(element:ReactElement<any>)=>ReactNode):ReactNode {
  return Children.map(node,child=>{
    if(!isValidElement<any>(child))return child;
    if(child.type===Fragment)return cloneElement(child,{},mapTree((child.props as {children?:ReactNode}).children,visit));
    return visit(child);
  });
}
/** Same controls and handlers on both layouts: a table on desktop and labelled cards on narrow screens. */
export function ResponsiveTable({children,className='',...props}:ComponentProps<'table'>){
  const headers:string[]=[];
  mapTree(children,section=>{
    if(section.type==='thead')mapTree(section.props.children,row=>{
      mapTree(row.props.children,cell=>{headers.push(text(cell.props.children)|| (Children.toArray(cell.props.children).length?'选择':'操作'));return cell});return row;
    });return section;
  });
  const content=mapTree(children,section=>{
    if(section.type!=='tbody')return section;
    const spans:number[]=[];
    return cloneElement(section,{},mapTree(section.props.children,row=>{
      if(row.type!=='tr')return row;
      let column=0;
      const cells=mapTree(row.props.children,cell=>{
        if(cell.type!=='td'&&cell.type!=='th')return cell;
        while(spans[column]>0)column++;
        const index=column;const width=Number(cell.props.colSpan||1);
        for(let i=0;i<width;i++)spans[column+i]=Number(cell.props.rowSpan||1);
        column+=width;
        return cloneElement(cell,{'data-label':width>1?'':headers[index]||'操作','data-wide':width>1?'true':undefined});
      });
      for(let i=0;i<spans.length;i++)spans[i]=Math.max(0,(spans[i]||0)-1);
      return cloneElement(row,{},cells);
    }));
  });
  return <table {...props} className={`${className} ${headers.length?'admin-responsive-table':''}`}>{content}</table>;
}
