"""Fine-tune a small YOLO segmentation model to find columns, then export it to ONNX for the browser.

  python train.py            trains on ml/data/columns.yaml, writes ml/runs/columns/weights/best.pt and ml/columns.onnx
"""
from pathlib import Path
from ultralytics import YOLO

HERE = Path(__file__).parent
model = YOLO("yolov8s-seg.pt")
model.train(
    data=str(HERE / "data" / "columns.yaml"), imgsz=960, epochs=120, batch=4, device=0, workers=2, patience=40,
    project=str(HERE / "runs"), name="columns", exist_ok=True, cache=True,
    # few photos: lean on augmentation so the model sees a photo from many angles, lights and scales
    mosaic=1.0, mixup=0.1, fliplr=0.5, degrees=6, translate=0.12, scale=0.5, shear=2, perspective=0.0008,
    hsv_h=0.02, hsv_s=0.6, hsv_v=0.45, close_mosaic=15,
)
best = YOLO(str(HERE / "runs" / "columns" / "weights" / "best.pt"))
print(best.val(data=str(HERE / "data" / "columns.yaml"), imgsz=960, device=0))
out = best.export(format="onnx", imgsz=960, opset=17, simplify=True, dynamic=False)
Path(out).replace(HERE / "columns.onnx")
print("exported", HERE / "columns.onnx")
