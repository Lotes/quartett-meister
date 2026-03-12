'use client';

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface RadarChartProps {
  data: { axis: string; value: number }[];
  maxValue: number;
  width?: number;
  height?: number;
  onValueChange?: (index: number, newValue: number) => void;
  interactive?: boolean;
}

export default function RadarChart({
  data,
  maxValue,
  width = 300,
  height = 300,
  onValueChange,
  interactive = false,
}: RadarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = 40;
    const radius = Math.min(width, height) / 2 - margin;
    const angleSlice = (Math.PI * 2) / data.length;

    const g = svg
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    // Draw background circles
    const levels = 5;
    for (let i = 0; i < levels; i++) {
      const r = (radius / levels) * (i + 1);
      g.append('circle')
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', '#e5e7eb')
        .attr('stroke-dasharray', '4 4');
    }

    // Draw axes
    const axes = g.selectAll('.axis').data(data).enter().append('g').attr('class', 'axis');

    axes
      .append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (d, i) => radius * Math.cos(angleSlice * i - Math.PI / 2))
      .attr('y2', (d, i) => radius * Math.sin(angleSlice * i - Math.PI / 2))
      .attr('stroke', '#9ca3af')
      .attr('stroke-width', '1px');

    // Labels
    axes
      .append('text')
      .attr('class', 'legend')
      .style('font-size', '10px')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('x', (d, i) => (radius + 20) * Math.cos(angleSlice * i - Math.PI / 2))
      .attr('y', (d, i) => (radius + 20) * Math.sin(angleSlice * i - Math.PI / 2))
      .text((d) => d.axis)
      .attr('fill', '#4b5563');

    // Radar area
    const radarLine = d3
      .lineRadial<{ axis: string; value: number }>()
      .radius((d) => (d.value / maxValue) * radius)
      .angle((d, i) => i * angleSlice)
      .curve(d3.curveLinearClosed);

    g.append('path')
      .datum(data)
      .attr('d', radarLine)
      .attr('fill', 'rgba(59, 130, 246, 0.2)')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2);

    // Interactive points
    if (interactive && onValueChange) {
      const drag = d3.drag<SVGCircleElement, { axis: string; value: number }>()
        .on('drag', function (event, d) {
          const i = data.indexOf(d);
          const sourceEv = event.sourceEvent;
          const pointerEv = sourceEv.changedTouches?.[0] ?? sourceEv.touches?.[0] ?? sourceEv;
          const [mouseX, mouseY] = d3.pointer(pointerEv, g.node());
          
          // Calculate distance from radar center
          const dist = Math.sqrt(mouseX * mouseX + mouseY * mouseY);
          let newValue = (dist / radius) * maxValue;
          newValue = Math.max(0, Math.min(maxValue, Math.round(newValue)));
          
          onValueChange(i, newValue);
        });

      g.selectAll('.point')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'point')
        .attr('cx', (d, i) => (d.value / maxValue) * radius * Math.cos(angleSlice * i - Math.PI / 2))
        .attr('cy', (d, i) => (d.value / maxValue) * radius * Math.sin(angleSlice * i - Math.PI / 2))
        .attr('r', 6)
        .attr('fill', '#3b82f6')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .style('cursor', 'pointer')
        .call(drag as any);
    } else {
      g.selectAll('.point')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'point')
        .attr('cx', (d, i) => (d.value / maxValue) * radius * Math.cos(angleSlice * i - Math.PI / 2))
        .attr('cy', (d, i) => (d.value / maxValue) * radius * Math.sin(angleSlice * i - Math.PI / 2))
        .attr('r', 3)
        .attr('fill', '#3b82f6');
    }
  }, [data, maxValue, width, height, interactive, onValueChange]);

  return (
    <div className="flex justify-center items-center">
      <svg ref={svgRef} width={width} height={height} />
    </div>
  );
}
