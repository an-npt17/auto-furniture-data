#!/usr/bin/env python3
"""
GUI for converting .max files to .fbx/.glb with hierarchy preservation
Simple drag-and-drop interface

Requirements: pip install PyQt5 (or use tkinter below)
"""

import os
import sys
from pathlib import Path

# Try PyQt5 first, fallback to tkinter
try:
    from PyQt5.QtCore import Qt, QThread, pyqtSignal
    from PyQt5.QtWidgets import (
        QApplication,
        QCheckBox,
        QComboBox,
        QFileDialog,
        QHBoxLayout,
        QLabel,
        QMainWindow,
        QProgressBar,
        QPushButton,
        QTextEdit,
        QVBoxLayout,
        QWidget,
    )

    USE_QT = True
except ImportError:
    import tkinter as tk
    from tkinter import filedialog, scrolledtext, ttk

    USE_QT = False

import subprocess


class ConverterWorker(QThread if USE_QT else object):
    """Worker thread for conversion"""

    progress = pyqtSignal(str) if USE_QT else None
    finished = pyqtSignal(bool) if USE_QT else None

    def __init__(self, input_file, output_file, options):
        if USE_QT:
            super().__init__()
        self.input_file = input_file
        self.output_file = output_file
        self.options = options

    def run(self):
        """Run conversion"""
        try:
            script_path = Path(__file__).parent / "max_to_fbx_preserve_hierarchy.py"

            cmd = [
                "blender",
                "--background",
                "--python",
                str(script_path),
                "--",
                self.input_file,
                self.output_file,
            ]

            if self.options.get("group_by_name"):
                cmd.append("--group-by-name")

            self.progress.emit(f"Starting conversion...\n")

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

            if result.returncode == 0:
                self.progress.emit(f"✓ Conversion successful!\n")
                self.progress.emit(f"Output: {self.output_file}\n")
                self.finished.emit(True)
            else:
                self.progress.emit(f"✗ Conversion failed\n")
                self.progress.emit(f"Error: {result.stderr}\n")
                self.finished.emit(False)

        except Exception as e:
            self.progress.emit(f"✗ Error: {str(e)}\n")
            self.finished.emit(False)


class MaxConverterGUI(QMainWindow if USE_QT else tk.Tk):
    """GUI for .max to .fbx/.glb conversion"""

    def __init__(self):
        super().__init__()
        self.input_file = None
        self.output_file = None

        if USE_QT:
            self.init_qt_ui()
        else:
            self.init_tk_ui()

    def init_qt_ui(self):
        """Initialize PyQt5 UI"""
        self.setWindowTitle(".max to FBX/GLB Converter")
        self.setGeometry(100, 100, 800, 600)

        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        layout = QVBoxLayout()

        # Title
        title = QLabel("3D Model Converter - Hierarchy Preserved")
        title.setStyleSheet("font-size: 18px; font-weight: bold; margin: 10px;")
        layout.addWidget(title)

        # Input file selection
        input_layout = QHBoxLayout()
        self.input_label = QLabel("No file selected")
        input_btn = QPushButton("Select Input File (.max/.3ds)")
        input_btn.clicked.connect(self.select_input_file)
        input_layout.addWidget(self.input_label)
        input_layout.addWidget(input_btn)
        layout.addLayout(input_layout)

        # Output format selection
        format_layout = QHBoxLayout()
        format_layout.addWidget(QLabel("Output Format:"))
        self.format_combo = QComboBox()
        self.format_combo.addItems(["FBX", "GLB", "glTF"])
        format_layout.addWidget(self.format_combo)
        format_layout.addStretch()
        layout.addLayout(format_layout)

        # Options
        self.group_by_name_cb = QCheckBox("Group objects by name prefix")
        self.preserve_hierarchy_cb = QCheckBox("Preserve hierarchy (recommended)")
        self.preserve_hierarchy_cb.setChecked(True)
        layout.addWidget(self.group_by_name_cb)
        layout.addWidget(self.preserve_hierarchy_cb)

        # Convert button
        self.convert_btn = QPushButton("Convert")
        self.convert_btn.clicked.connect(self.start_conversion)
        self.convert_btn.setStyleSheet(
            "font-size: 16px; padding: 10px; background-color: #4CAF50; color: white;"
        )
        layout.addWidget(self.convert_btn)

        # Progress
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        layout.addWidget(self.progress_bar)

        # Log output
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        layout.addWidget(self.log_output)

        central_widget.setLayout(layout)

        # Info text
        self.log("Ready to convert .max files to FBX/GLB\n")
        self.log(
            "This tool preserves object hierarchy and parent-child relationships\n"
        )

    def init_tk_ui(self):
        """Initialize tkinter UI (fallback)"""
        self.title(".max to FBX/GLB Converter")
        self.geometry("800x600")

        # Title
        title = tk.Label(
            self,
            text="3D Model Converter - Hierarchy Preserved",
            font=("Arial", 16, "bold"),
        )
        title.pack(pady=10)

        # Input file
        input_frame = tk.Frame(self)
        input_frame.pack(pady=5, fill=tk.X, padx=10)
        self.input_label = tk.Label(input_frame, text="No file selected")
        self.input_label.pack(side=tk.LEFT, padx=5)
        input_btn = tk.Button(
            input_frame, text="Select Input File", command=self.select_input_file
        )
        input_btn.pack(side=tk.RIGHT, padx=5)

        # Format selection
        format_frame = tk.Frame(self)
        format_frame.pack(pady=5, fill=tk.X, padx=10)
        tk.Label(format_frame, text="Output Format:").pack(side=tk.LEFT, padx=5)
        self.format_var = tk.StringVar(value="FBX")
        format_combo = ttk.Combobox(
            format_frame, textvariable=self.format_var, values=["FBX", "GLB", "glTF"]
        )
        format_combo.pack(side=tk.LEFT, padx=5)

        # Options
        self.group_by_name_var = tk.BooleanVar()
        self.preserve_hierarchy_var = tk.BooleanVar(value=True)

        tk.Checkbutton(
            self, text="Group objects by name prefix", variable=self.group_by_name_var
        ).pack(pady=5)
        tk.Checkbutton(
            self,
            text="Preserve hierarchy (recommended)",
            variable=self.preserve_hierarchy_var,
        ).pack(pady=5)

        # Convert button
        self.convert_btn = tk.Button(
            self,
            text="Convert",
            command=self.start_conversion,
            bg="#4CAF50",
            fg="white",
            font=("Arial", 14),
            height=2,
        )
        self.convert_btn.pack(pady=10, fill=tk.X, padx=10)

        # Log output
        self.log_output = scrolledtext.ScrolledText(self, height=20)
        self.log_output.pack(pady=10, fill=tk.BOTH, expand=True, padx=10)

        self.log("Ready to convert .max files to FBX/GLB\n")
        self.log(
            "This tool preserves object hierarchy and parent-child relationships\n"
        )

    def select_input_file(self):
        """Select input file"""
        if USE_QT:
            file_path, _ = QFileDialog.getOpenFileName(
                self,
                "Select Input File",
                "",
                "3D Models (*.max *.3ds *.obj *.fbx);;All Files (*.*)",
            )
        else:
            file_path = filedialog.askopenfilename(
                title="Select Input File",
                filetypes=[
                    ("3D Models", "*.max *.3ds *.obj *.fbx"),
                    ("All Files", "*.*"),
                ],
            )

        if file_path:
            self.input_file = file_path
            file_name = os.path.basename(file_path)

            if USE_QT:
                self.input_label.setText(file_name)
            else:
                self.input_label.config(text=file_name)

            self.log(f"Selected: {file_name}\n")

            # Auto-suggest output file
            output_format = (
                self.format_combo.currentText().lower()
                if USE_QT
                else self.format_var.get().lower()
            )
            self.output_file = str(Path(file_path).with_suffix(f".{output_format}"))

    def start_conversion(self):
        """Start the conversion process"""
        if not self.input_file:
            self.log("Error: Please select an input file\n")
            return

        # Get output format
        if USE_QT:
            output_format = self.format_combo.currentText().lower()
        else:
            output_format = self.format_var.get().lower()

        # Update output file with selected format
        self.output_file = str(Path(self.input_file).with_suffix(f".{output_format}"))

        # Get options
        options = {
            "group_by_name": self.group_by_name_cb.isChecked()
            if USE_QT
            else self.group_by_name_var.get(),
            "preserve_hierarchy": self.preserve_hierarchy_cb.isChecked()
            if USE_QT
            else self.preserve_hierarchy_var.get(),
        }

        self.log(f"\nStarting conversion...\n")
        self.log(f"Input:  {self.input_file}\n")
        self.log(f"Output: {self.output_file}\n")
        self.log(f"Format: {output_format.upper()}\n")

        if USE_QT:
            # Disable button during conversion
            self.convert_btn.setEnabled(False)
            self.progress_bar.setVisible(True)
            self.progress_bar.setRange(0, 0)  # Indeterminate

            # Start worker thread
            self.worker = ConverterWorker(self.input_file, self.output_file, options)
            self.worker.progress.connect(self.log)
            self.worker.finished.connect(self.conversion_finished)
            self.worker.start()
        else:
            # Run synchronously in tkinter
            self.run_conversion(options)

    def run_conversion(self, options):
        """Run conversion (for tkinter)"""
        try:
            script_path = Path(__file__).parent / "max_to_fbx_preserve_hierarchy.py"

            cmd = [
                "blender",
                "--background",
                "--python",
                str(script_path),
                "--",
                self.input_file,
                self.output_file,
            ]

            if options.get("group_by_name"):
                cmd.append("--group-by-name")

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

            if result.returncode == 0:
                self.log("✓ Conversion successful!\n")
            else:
                self.log("✗ Conversion failed\n")
                self.log(f"Error: {result.stderr}\n")

        except Exception as e:
            self.log(f"✗ Error: {str(e)}\n")

    def conversion_finished(self, success):
        """Handle conversion completion (Qt)"""
        self.convert_btn.setEnabled(True)
        self.progress_bar.setVisible(False)

        if success:
            self.log(
                "\n✓ All done! You can now import the file into your 3D software.\n"
            )

    def log(self, message):
        """Add message to log"""
        if USE_QT:
            self.log_output.append(message)
        else:
            self.log_output.insert(tk.END, message)
            self.log_output.see(tk.END)


def main():
    if USE_QT:
        app = QApplication(sys.argv)
        window = MaxConverterGUI()
        window.show()
        sys.exit(app.exec_())
    else:
        app = MaxConverterGUI()
        app.mainloop()


if __name__ == "__main__":
    main()
