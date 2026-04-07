'use client';

import { NodeViewWrapper } from '@tiptap/react';
import React, { useState } from 'react';
import { Bar, Scatter, Line, Pie } from 'react-chartjs-2';
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
} from 'chart.js';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { Upload, Plus, Trash2, Edit3, Save } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

export default function ChartComponent({ node: { attrs }, updateAttributes }: any) {
  const [editing, setEditing] = useState(false);
  const data = attrs.data || { labels: ['A', 'B', 'C'], datasets: [{ label: 'Data', data: [10, 20, 15], backgroundColor: 'rgba(255, 182, 193, 0.6)' }] };
  const type = attrs.type || 'bar';

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        complete: (results) => {
          const rows = results.data as string[][];
          const labels = rows.map(r => r[0]);
          const values = rows.map(r => parseFloat(r[1]));
          updateAttributes({ 
            data: { 
              labels, 
              datasets: [{ label: file.name, data: values, backgroundColor: 'rgba(255, 182, 193, 0.6)' }] 
            } 
          });
        }
      });
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const bstr = event.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        const labels = rows.map(r => r[0]);
        const values = rows.map(r => parseFloat(r[1]));
        updateAttributes({ 
            data: { 
              labels, 
              datasets: [{ label: file.name, data: values, backgroundColor: 'rgba(255, 182, 193, 0.6)' }] 
            } 
          });
      };
      reader.readAsBinaryString(file);
    }
  };

  const updateTableData = (rowIndex: number, value: any, isLabel = false) => {
      const newData = { ...data };
      if (isLabel) {
        newData.labels[rowIndex] = value;
      } else {
        newData.datasets[0].data[rowIndex] = parseFloat(value) || 0;
      }
      updateAttributes({ data: newData });
  };

  const addRow = () => {
      const newData = { ...data };
      newData.labels.push(`New ${newData.labels.length + 1}`);
      newData.datasets[0].data.push(0);
      updateAttributes({ data: newData });
  };

  const deleteRow = (index: number) => {
      const newData = { ...data };
      newData.labels.splice(index, 1);
      newData.datasets[0].data.splice(index, 1);
      updateAttributes({ data: newData });
  };

  const ChartChild = type === 'bar' ? Bar : type === 'line' ? Line : type === 'pie' ? Pie : Scatter;

  return (
    <NodeViewWrapper className="chart-wrapper">
      <div className="chart-header" contentEditable={false}>
          <select 
            value={type} 
            onChange={e => updateAttributes({ type: e.target.value })}
            className="type-select"
          >
            <option value="bar">棒グラフ</option>
            <option value="line">折れ線グラフ</option>
            <option value="pie">パイチャート</option>
            <option value="scatter">散布図</option>
          </select>
          <button className="btn-edit" onClick={() => setEditing(!editing)}>
            {editing ? <Save size={16} /> : <Edit3 size={16} />}
            {editing ? '保存' : 'データを編集'}
          </button>
      </div>

      {editing ? (
        <div className="chart-editor" contentEditable={false}>
            <div className="upload-section">
                <label className="btn-upload">
                    <Upload size={18} />
                    Excel/CSVを読み込む
                    <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={handleFileUpload} />
                </label>
            </div>
            <table className="data-table">
                <thead>
                    <tr>
                        <th>項目名</th>
                        <th>値</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {data.labels.map((label: string, i: number) => (
                        <tr key={i}>
                            <td><input value={label} onChange={e => updateTableData(i, e.target.value, true)} /></td>
                            <td><input type="number" value={data.datasets[0].data[i]} onChange={e => updateTableData(i, e.target.value)} /></td>
                            <td><button className="btn-delete" onClick={() => deleteRow(i)}><Trash2 size={14} /></button></td>
                        </tr>
                    ))}
                    <tr>
                        <td colSpan={3}>
                            <button className="btn-add-row" onClick={addRow}><Plus size={14} /> 行を追加</button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
      ) : (
        <div className="chart-render" contentEditable={false}>
            <ChartChild 
                data={data} 
                options={{ 
                    responsive: true,
                    plugins: { legend: { position: 'top' as const } }
                }} 
            />
        </div>
      )}

      <style jsx>{`
        .chart-wrapper {
          margin: 1.5rem 0;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
        }
        .chart-header {
          padding: 8px 16px;
          background: var(--muted);
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .type-select {
          background: var(--background);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 4px 8px;
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
        }
        .chart-editor {
          padding: 20px;
          background: var(--background);
        }
        .upload-section {
          margin-bottom: 16px;
        }
        .btn-upload {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: var(--accent);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .data-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .data-table th {
          padding: 8px;
          border: 1px solid var(--border);
          background: var(--muted);
          color: var(--foreground);
          font-weight: 600;
        }
        .data-table td {
          padding: 4px 8px;
          border: 1px solid var(--border);
          background: var(--background);
        }
        .data-table input {
          width: 100%;
          border: none;
          padding: 4px;
          background: transparent;
          color: var(--foreground);
          outline: none;
        }
        .btn-delete {
          color: #ff4d4d;
          background: transparent;
        }
        .btn-add-row {
          width: 100%;
          padding: 6px;
          background: var(--accent);
          color: var(--foreground);
          border-radius: 6px;
          font-size: 0.85rem;
        }
        .chart-render {
          padding: 24px;
          max-height: 400px;
          display: flex;
          justify-content: center;
          background: var(--background);
        }
      `}</style>
    </NodeViewWrapper>
  );
}
