// scripts/use-three-step.mjs
import 'dotenv/config';

// ⬇️ paste any multiline text here
const text = `
Abelian screening sign (collar RG) — crisp derivation

Setup. Static collar of thickness 
𝐿
L normal to 
\\Sig
\\Sig with boundary potential 
𝜙
0
(
𝑥
)
ϕ
0
\t​

(x). Solving Laplace in the collar gives the Dirichlet-to-Neumann map

𝜎
𝑘
  
=
  
𝜀
e
f
f
 
∣
𝑘
∣
 
coth
⁡
 ⁣
(
∣
𝑘
∣
𝐿
)
 
𝜙
𝑘
(
0
)
,
σ
k
\t​

=ε
eff
\t​

∣k∣coth(∣k∣L)ϕ
k
\t​

(0),

so the effective boundary quadratic form (static energy) is

𝐻
e
f
f
[
𝜙
0
]
=
𝜀
e
f
f
2
∫
 ⁣
𝑑
2
𝑘
(
2
𝜋
)
2
 
∣
𝑘
∣
 
coth
⁡
(
∣
𝑘
∣
𝐿
)
 
∣
𝜙
𝑘
(
0
)
∣
2
.
H
eff
\t​

[ϕ
0
\t​

]=
2
ε
eff
\t​

\t​

∫
(2π)
2
d
2
k
\t​

∣k∣coth(∣k∣L)∣ϕ
k
\t​

(0)∣
2
.

Integrate out a thin collar shell. Coarse-grain by removing a thin layer 
𝛿
𝐿
>
0
δL>0 adjacent to 
\\Sig
\\Sig (so 
𝐿
→
𝐿
−
𝛿
𝐿
L→L−δL). The kernel shifts by

𝛿
𝐾
𝑘
  
=
  
𝜀
e
f
f
 
∣
𝑘
∣
 
[
coth
⁡
(
∣
𝑘
∣
(
𝐿
−
𝛿
𝐿
)
)
−
coth
⁡
(
∣
𝑘
∣
𝐿
)
]
  
≈
  
−
 
𝜀
e
f
f
 
∣
𝑘
∣
2
 
c
s
c
h
2
(
∣
𝑘
∣
𝐿
)
  
𝛿
𝐿
  
>
  
0
,
δK
k
\t​

=ε
eff
\t​

∣k∣[coth(∣k∣(L−δL))−coth(∣k∣L)]≈−ε
eff
\t​

∣k∣
2
csch
2
(∣k∣L)δL>0,

because 
∂
𝐿
coth
⁡
(
∣
𝑘
∣
𝐿
)
=
−
 
∣
𝑘
∣
 
c
s
c
h
2
(
∣
𝑘
∣
𝐿
)
 ⁣
<
0
∂
L
\t​

coth(∣k∣L)=−∣k∣csch
2
(∣k∣L)<0. Thus removing collar increases 
𝐾
𝑘
K
k
\t​

.

Implication for the Green’s function. The boundary Green’s function is 
𝐺
𝑘
=
1
/
𝐾
𝑘
G
k
\t​

=1/K
k
\t​

. Its shift is

𝛿
𝐺
𝑘
  
=
  
−
 
𝐺
𝑘
 
2
 
𝛿
𝐾
𝑘
  
<
  
0
(
𝛿
𝐿
>
0
)
.
δG
k
\t​

=−G
k
2
\t​

δK
k
\t​

<0(δL>0).

So coarse-graining (integrating out the shell) reduces 
𝐺
𝑘
G
k
\t​

 and therefore weakens the Coulomb response at fixed tangential momentum 
𝑘
k: that is screening in the Abelian sector.

Sign summary. With RG “scale” 
𝜇
∼
1
/
𝐿
μ∼1/L, a step to higher 
𝜇
μ (smaller 
𝐿
L) makes 
𝐾
𝑘
K
k
\t​

 larger and 
𝐺
𝑘
G
k
\t​

 smaller. In standard language where the effective charge sits in the inverse kernel, this corresponds to the QED sign (screening; 
𝛽
>
0
β>0 in the usual convention for 
𝛼
(
𝜇
)
α(μ)).
`.trim();

process.env.TEXT = text;                         // used by src/examples/three_step/run.ts
process.env.RUN_ID = process.env.RUN_ID || 'three-step-from-script';
process.env.OPENAI_API_STYLE = process.env.OPENAI_API_STYLE || 'chat'; // or 'responses'

// Importing the built runner executes the flow and prints outputs
await import('../dist/examples/three_step/run.js');
