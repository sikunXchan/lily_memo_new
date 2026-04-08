'use client';

import { NodeViewWrapper } from '@tiptap/react';
import React, { useState, useRef, useMemo } from 'react';
import { Bar, Line, Pie, Scatter } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { Upload, Edit3, Save, Download, Play, FileSpreadsheet } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const defaultCode = `// Chart.jsの設定オブジェクトを返してください。
// 読み込んだCSV/Excelデータは変数 "fileData" に配列として格納されます。
// 例として、最初の行をラベルとし、それ以降の行をデータセットとして扱うことができます。

const labels = fileData ? fileData.slice(1).map(row => row[0]) : ['1月', '2月', '3月'];
const dataValues = fileData ? fileData.slice(1).map(row => Number(row[1])) : [10, 20, 15];

return {
  type: 'bar', // 'line', 'bar', 'pie', 'scatter'
  data: {
    labels: labels,
    datasets: [{
      label: fileData && fileData[0] ? fileData[0][1] || 'Dataset 1' : 'データ',
      data: dataValues,
      backgroundColor: 'rgba(255, 182, 193, 0.6)',
      borderColor: 'rgba(255, 182, 193, 1)',
      borderWidth: 1
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { position: 'top' } }
  }
};`;

export default function ChartComponent({ node: { attrs }, updateAttributes }: any) {
  const [editing, setEditing] = useState(false);
  const chartRef = useRef<ChartJS>(null);

  const getInitialCode = () => {
    if (attrs.code) return attrs.code;
    if (attrs.data && Object.keys(attrs.data).length > 0) {
      return `// 過去のグラフデータからの復元コード
return {
  type: '${attrs.type || 'bar'}',
  data: ${JSON.stringify(attrs.data, null, 2)},
  options: { responsive: true, plugins: { legend: { position: 'top' } } }
};`;
    }
    return defaultCode;
  };

  const code = attrs.code || getInitialCode();
  const fileData = attrs.fileData || null;
  const fileName = attrs.fileName || '';
  
  const [localCode, setLocalCode] = useState(code);
  const [errorMsg, setErrorMsg] = useState('');

  // 実際の設定オブジェクトを生成
  const computedConfig = useMemo(() => {
    try {
      const func = new Function('fileData', code);
      const res = func(fileData);
      return { config: res, error: null };
    } catch (e: any) {
      return { config: null, error: e.message };
    }
  }, [code, fileData]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        complete: (results) => {
          updateAttributes({ 
            fileData: results.data,
            fileName: file.name 
          });
        }
      });
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const bstr = event.target?.result;
        try {
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
          updateAttributes({ 
            fileData: rows,
            fileName: file.name 
          });
        } catch (err: any) {
             alert('ファイルの読み込みに失敗しました。');
        }
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleSaveCode = () => {
    try {
      // 構文チェック
      new Function('fileData', localCode);
      updateAttributes({ code: localCode });
      setErrorMsg('');
      setEditing(false); // 保存時に編集モードを閉じる
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  // PNGとしてエクスポート
  const exportAsPng = () => {
    if (!chartRef.current) return;
    const url = (chartRef.current as any).canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.download = `${fileName || 'chart'}.png`;
    a.href = url;
    a.click();
  };

  return (
    <NodeViewWrapper 
       className="chart-wrapper" 
       style={{ width: attrs.width || '100%' }}
    >
      <div className="chart-header" contentEditable={false}>
          <div className="header-info">
             <span className="title-text">📊 JS Chart</span>
             {fileName && <span className="file-badge"><FileSpreadsheet size={12}/> {fileName}</span>}
          </div>
          <div className="chart-header-actions">
            <select
              value={attrs.width || '100%'}
              onChange={(e) => updateAttributes({ width: e.target.value })}
              className="size-select"
              title="グラフサイズの変更"
            >
              <option value="25%">25%</option>
              <option value="50%">50%</option>
              <option value="75%">75%</option>
              <option value="100%">100%</option>
              <option value="125%">125%</option>
              <option value="150%">150%</option>
              <option value="200%">200%</option>
              <option value="300%">300%</option>
            </select>
            {!editing && (
              <button className="btn-export" onClick={exportAsPng} title="PNG画像として保存">
                <Download size={14} /> PNG
              </button>
            )}
            <button className="btn-edit" onClick={() => {
                if (editing) {
                    handleSaveCode();
                } else {
                    setLocalCode(attrs.code || getInitialCode());
                    setEditing(true);
                }
            }}>
              {editing ? <Save size={16} /> : <Edit3 size={16} />}
              {editing ? '完了' : 'コード編集'}
            </button>
          </div>
      </div>

      {editing ? (
        <div className="chart-editor" contentEditable={false}>
            <div className="upload-section">
                <label className="btn-upload">
                    <Upload size={16} />
                    CSV / Excelを読み込む
                    <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={handleFileUpload} />
                </label>
            </div>
            
            <div className="code-editor-wrapper">
               <textarea 
                 value={localCode}
                 onChange={e => setLocalCode(e.target.value)}
                 onWheel={(e) => e.stopPropagation()}
                 onTouchMove={(e) => e.stopPropagation()}
                 onKeyDown={(e) => e.stopPropagation()}
                 className="code-textarea"
                 spellCheck={false}
               />
               <button className="btn-run" onClick={handleSaveCode}><Play size={14}/> 適用</button>
            </div>
            
            {errorMsg && <div className="error-message">Error: {errorMsg}</div>}
        </div>
      ) : (
        <div className="chart-render" contentEditable={false}>
            {computedConfig.error ? (
                <div className="error-message">
                  コードの実行エラー: {computedConfig.error}
                </div>
            ) : computedConfig.config ? (
                (() => {
                    const chartConfig = computedConfig.config;
                    if (!chartConfig.data || !Array.isArray(chartConfig.data.datasets)) {
                        return <div className="error-message">グラフデータの形式が不正です（datasets配列が見つかりません）。</div>;
                    }
                    const chartType = chartConfig.type || 'bar';
                    const props = {
                        ref: chartRef as any,
                        data: chartConfig.data,
                        options: chartConfig.options
                    };
                    return chartType === 'line' ? <Line {...props} /> :
                           chartType === 'pie' ? <Pie {...props} /> :
                           chartType === 'scatter' ? <Scatter {...props} /> :
                           <Bar {...props} />;
                })()
            ) : (
                <div className="placeholder">設定がありません。</div>
            )}
        </div>
      )}

      <style jsx>{`
        .chart-wrapper {
          margin: 1.5rem auto;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          transition: width 0.3s ease;
        }
        .chart-header {
          padding: 8px 16px;
          background: var(--muted);
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .header-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .title-text {
          font-weight: 700;
          font-size: 0.9rem;
          color: var(--foreground);
        }
        .file-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--primary);
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .chart-header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .size-select {
          padding: 2px 6px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--background);
          color: var(--foreground);
          font-size: 0.75rem;
          outline: none;
          cursor: pointer;
        }
        .btn-export {
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--accent);
          color: var(--foreground);
          border: 1px solid var(--border);
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.78rem;
          font-weight: 600;
          white-space: nowrap;
          cursor: pointer;
        }
        .btn-export:hover {
          background: var(--border);
        }
        .btn-edit {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--primary);
          color: white;
          padding: 4px 12px;
          border-radius: 8px;
          font-size: 0.85rem;
          cursor: pointer;
          border: none;
        }
        .chart-editor {
          padding: 20px;
          background: var(--background);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .upload-section {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .btn-upload {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 16px;
          background: var(--accent);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: 600;
        }
        .code-editor-wrapper {
          position: relative;
          width: 100%;
        }
        .code-textarea {
          width: 100%;
          min-height: 250px;
          background: #1e1e1e;
          color: #d4d4d4;
          font-family: 'Fira Code', 'Consolas', monospace;
          font-size: 0.9rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
          outline: none;
          line-height: 1.5;
          resize: vertical;
        }
        .btn-run {
           position: absolute;
           bottom: 16px;
           right: 24px;
           display: flex;
           align-items: center;
           gap: 4px;
           background: var(--primary);
           color: white;
           border: none;
           padding: 6px 16px;
           border-radius: 6px;
           font-size: 0.85rem;
           font-weight: 600;
           cursor: pointer;
        }
        .error-message {
          color: #cc0000;
          background: #ffe6e6;
          padding: 12px;
          border-radius: 6px;
          font-family: monospace;
          font-size: 0.85rem;
          word-break: break-all;
        }
        .chart-render {
          padding: 24px;
          max-height: 500px;
          display: flex;
          justify-content: center;
          background: var(--background);
        }
      `}</style>
    </NodeViewWrapper>
  );
}
