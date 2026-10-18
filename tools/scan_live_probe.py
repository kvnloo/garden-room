"""One-time real model/CUDA readiness probe; no room state writes."""
import os, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
os.environ['HF_HOME'] = str(ROOT / 'work/models/hf')
os.environ['TORCH_EXTENSIONS_DIR'] = str(ROOT / 'work/models/torch_extensions')
os.environ['TORCH_CUDA_ARCH_LIST'] = '8.6'
os.environ['MAX_JOBS'] = '4'
import torch
from transformers import Owlv2Processor, Owlv2ForObjectDetection
start=time.perf_counter()
model_id='google/owlv2-base-patch16-ensemble'
p=Owlv2Processor.from_pretrained(model_id)
m=Owlv2ForObjectDetection.from_pretrained(model_id).cuda().eval()
from PIL import Image
image=Image.open(ROOT / 'refs/20261018_121441.jpg').convert('RGB'); image.thumbnail((640,640))
texts=['a dining table','a glass table','a refrigerator','a china cabinet','a potted plant','a floor lamp','a window','a door']
x=p(text=[texts],images=image,return_tensors='pt').to('cuda')
for i in range(2):
    t=time.perf_counter()
    with torch.inference_mode(): out=m(**x)
    torch.cuda.synchronize()
    print('owl seconds',time.perf_counter()-t,flush=True)
    result=p.post_process_grounded_object_detection(out,target_sizes=torch.tensor([[image.height,image.width]],device='cuda'),threshold=.12)[0]
    print([(texts[int(c)],round(float(s),3),b.tolist()) for c,s,b in zip(result['labels'],result['scores'],result['boxes'])],flush=True)
print('load seconds',time.perf_counter()-start,flush=True)
try:
    from gsplat import rasterization
    z=torch.tensor([[0.,0.,2.]],device='cuda',requires_grad=True)
    q=torch.tensor([[1.,0.,0.,0.]],device='cuda',requires_grad=True)
    sc=torch.full((1,3),.05,device='cuda',requires_grad=True)
    op=torch.tensor([.8],device='cuda',requires_grad=True)
    col=torch.tensor([[.4,.8,.2]],device='cuda',requires_grad=True)
    k=torch.tensor([[[100.,0.,32.],[0.,100.,32.],[0.,0.,1.]]],device='cuda')
    rgb,alpha,info=rasterization(z,q,sc,op,col,torch.eye(4,device='cuda')[None],k,64,64)
    rgb.mean().backward(); torch.cuda.synchronize()
    print('gsplat CUDA forward/backward OK',rgb.shape,flush=True)
except Exception:
    import traceback; traceback.print_exc()
