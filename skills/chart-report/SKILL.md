---
name: chart-report
description: Produce a chart and a written summary from a dataset. Use when the user asks for a chart, a plot, a visual, or a report of a dataset's shape - trends over time, distributions, comparisons between groups.
---

# Chart report

Turns a dataset into one clear chart plus a short written reading of it.

## Steps

1. **Look at the data before plotting it.** Print the shape, the column names,
   the dtypes and a few rows. State the row count in your answer.
2. **Pick the chart from the question, not from habit.**
   - change over time → line
   - comparison across categories → horizontal bar, sorted by value
   - distribution of one variable → histogram
   - relationship between two variables → scatter
   If a pie chart seems right, use a sorted bar chart instead.
3. **Plot it** with matplotlib. One chart per answer unless asked otherwise.
4. **Read the chart back** in two or three sentences: what it shows, the
   largest effect, and anything that looks like an artefact rather than a
   finding.

## Chart rules

- Label both axes, including units. Title the chart with the finding
  ("Signups fell 40% after the March change"), not the mechanics
  ("Signups by month").
- Start a bar chart's value axis at zero. A line chart's need not start at zero,
  but say so if it does not.
- Sort categorical bars by value, not alphabetically, unless the categories
  have a natural order.
- No gridlines heavier than the data, no chartjunk, no 3D.
- `plt.tight_layout()` before saving so labels are not clipped.

## Reporting rules

- Give the number alongside the shape: "roughly flat" is weaker than "within
  ±2% across the period".
- Say what the data cannot tell you. If the series is 8 points long, do not
  describe it as a trend.
- If the data needed cleaning - dropped rows, coerced types, filled gaps - say
  what you did and how many rows it affected.
