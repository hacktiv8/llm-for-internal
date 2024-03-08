# LLM For Internal

## Conversation Understanding

```shell
git checkout 7-vectorize
npm install
```

## Vectorization

```text
$ node vector-encode.js "Pluto is not a planet anymore"

{
  text: 'Pluto is not a planet anymore',
  embedding: Float32Array(3072) [
    0.022357795387506485,    0.03247959166765213,   0.07495807856321335,
      0.046893879771232605,   0.015704385936260223,  -0.08690059930086136,
      -0.04375727102160454,    0.04941114783287048,    0.0069654262624681,
       0.08460677415132523,   0.008333341218531132,  0.021070076152682304,
      -0.08120545744895935,  -0.002545442432165146,  0.008332804776728153,
    ... 2972 more items
  ]
}
```

## Simulate Vector Comparation

```text
$ node vector-sim.js "Which planet is the largest?" "Jupiter is the largest planet?"
Comparing...
        Which planet is the largest?
        Jupiter is the largest planet?

0.46345715075525395

$ node vector-sim.js "Which planet is the largest?" "Avicenna wrote the Canon of Medicine"
Comparing...
        Which planet is the largest?
        Avicenna wrote the Canon of Medicine

0.010989142422621308
```

## Questions

- Please tell me how much revenue GoTo made in 2022?
