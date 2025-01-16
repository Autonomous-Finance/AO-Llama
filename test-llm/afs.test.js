const { describe, it } = require('node:test')
const assert = require('assert')
const weaveDrive = require('./weavedrive.js')
const fs = require('fs')
const wasm = fs.readFileSync('./process.wasm')
// STEP 1 send a file id
const m = require(__dirname + '/process.js')
const AdmissableList =
  [
    "dx3GrOQPV5Mwc1c-4HTsyq0s1TNugMf7XfIKJkyVQt8", // Random NFT metadata (1.7kb of JSON)
    "tbjTJMP8zMrOcw8qKyctG7jgaTylL7DlHSp_eVTFQFI", // gpt2-q8_0.gguf (117m)
    "cHFkDGROsDET23OAeIXitx8Y7qTCfiJg0wJiYsljrmM", // gemma-2-2b-Q4_K_M.gguf (2b)
    "rZ-B83MGQSwMACsMQOT9K3N8Auq-hiH9y0Ruk4vPnW4", // SmolLM2-135M-Instruct-Q6_K_L.gguf (135m)
    "t300X9ADb1Io6p7dBiSSRmOFHXHTVo5UNnfJ1eZdMrk", // Mistral-Nemo-Instruct-2407.Q4_K_M.gguf (12b)
    "eX8b3CA1hxKqBFyqNG90KeGZhIoRwxT2MdRLKkXS8ck", // dolphin-2.2.1-mistral-7b.Q5_K_M.gguf (7b)
    "gyxsYaH_0hvhtZki475W0iHbV5GLtjngv_LhDGui-rk", // MN-12B-Starcannon-v2.Q4_K_M.gguf (12b)
  ]

describe('AOS-Llama+VFS Tests', async () => {
  var instance;
  const handle = async function (msg, env) {
    const res = await instance.cwrap('handle', 'string', ['string', 'string'], { async: true })(JSON.stringify(msg), JSON.stringify(env))
    console.log('Memory used:', instance.HEAP8.length)
    return JSON.parse(res)
  }

  it('Create instance', async () => {
    console.log("Creating instance...")
    var instantiateWasm = function (imports, cb) {

      // merge imports argument
      const customImports = {
        env: {
          memory: new WebAssembly.Memory({ initial: 8589934592 / 65536, maximum: 17179869184 / 65536, index: 'i64' })
        }
      }
      //imports.env = Object.assign({}, imports.env, customImports.env)

      WebAssembly.instantiate(wasm, imports).then(result =>

        cb(result.instance)
      )
      return {}
    }

    instance = await m({
      admissableList: AdmissableList,
      WeaveDrive: weaveDrive,
      ARWEAVE: 'https://arweave.net',
      mode: "test",
      blockHeight: 100,
      spawn: {
        "Scheduler": "TEST_SCHED_ADDR"
      },
      process: {
        id: "TEST_PROCESS_ID",
        owner: "TEST_PROCESS_OWNER",
        tags: [
          { name: "Extension", value: "Weave-Drive" }
        ]
      },
      instantiateWasm
    })
    await new Promise((r) => setTimeout(r, 1000));
    console.log("Instance created.")
    await new Promise((r) => setTimeout(r, 250));

    assert.ok(instance)
  })

  it('Eval Lua', async () => {
    console.log("Running eval")
    const result = await handle(getEval('1 + 1'), getEnv())
    console.log("Eval complete")
    assert.equal(result.response.Output.data, 2)
  })

  it('Add data to the VFS', async () => {
    await instance['FS_createPath']('/', 'data')
    await instance['FS_createDataFile']('/', 'data/1', Buffer.from('HELLO WORLD'), true, false, false)
    const result = await handle(getEval('return "OK"'), getEnv())
    assert.ok(result.response.Output.data == "OK")
  })

  it.skip('Read data from the VFS', async () => {
    const result = await handle(getEval(`
local file = io.open("/data/1", "r")
if file then
  local content = file:read("*a")
  output = content
  file:close()
else
  return "Failed to open the file"
end
return output`), getEnv())
    console.log(result.response.Output)
    assert.ok(result.response.Output.data.output == "HELLO WORLD")
  })

  it.skip('Read data from Arweave', async () => {
    const result = await handle(getEval(`
local file = io.open("/data/dx3GrOQPV5Mwc1c-4HTsyq0s1TNugMf7XfIKJkyVQt8", "r")
if file then
  local content = file:read("*a")
  file:close()
  return string.sub(content, 1, 10)
else
  return "Failed to open the file"
end`), getEnv())
    assert.ok(result.response.Output.data.output.length == 10)
  })

  it('Llama Lua library loads', async () => {
    const result = await handle(getEval(`
local Llama = require(".Llama")
--llama.load("/data/ggml-tiny.en.bin")
return Llama.info()
`), getEnv())
    console.log(' OUT ', result.response.Output.data)
    assert.ok(result.response.Output.data == "A decentralized LLM inference engine, built on top of llama.cpp.")
  })


  it.skip('AOS runs smolllm 135m', async () => {
    const result = await handle(
      getLua('SmolLM2-135M-Instruct-Q6_K_L.gguf', 200),
      getEnv())
    console.log(result)
    console.log("SIZE:", instance.HEAP8.length)
    assert.ok(result.response.Output.data.output.length > 10)
  })

  it.skip('AOS runs smolllm 1.7B', async () => {
    const result = await handle(
      getLua('SmolLM2-1.7B-Instruct-Q6_K.gguf', 250),
      getEnv())
    console.log('result', result)
    console.log("SIZE:", instance.HEAP8.length)
    assert.ok(result.response.Output.data.length > 10)
  })

  it('AOS runs nemo (q4)', async () => {
    const result = await handle(
      getLua('MN-12B-Starcannon-v2.Q4_K_M.gguf', 100), //MN-12B-Starcannon-v2.Q4_K_M.gguf
      getEnv())
    console.log(result)
    console.log("SIZE:", instance.HEAP8.length)
    assert.ok(result.response.Output.data.output.length > 10)
  })

  it.skip('AOS runs nemo (q8)', async () => {
    const result = await handle(
      getLua('Mistral-Nemo-Instruct-2407.Q8_0.gguf', 100),
      getEnv())
    console.log(result)
    console.log("SIZE:", instance.HEAP8.length)
    assert.ok(result.response.Output.data.output.length > 10)
  })


  it.skip('AOS runs gemma 2b', async () => {
    const result = await handle(getEval(`
  local Llama = require(".Llama")
  Llama.logLevel = -1
  io.stderr:write([[Loading model...\n]])
  local result = Llama.load("/data/gemma-2-2b-Q4_K_M.gguf")
  io.stderr:write([[Loaded! Setting prompt 1...\n]])
  Llama.setPrompt("Once upon a time")
  io.stderr:write([[Prompt set! Running...\n]])
  local str = Llama.run(30)
  return str
  `), getEnv())
    console.log(' OUT ', result.response)

    // console.log("START SECOND MESSAGE")
    // const result2 = await handle(getEval(`
    // Llama.setPrompt("How do you feel about rabbits? ")
    // io.stderr:write([[Prompt set! Running 2...\n]])
    // local str = Llama.run(30)
    // return str
    // `), getEnv())
    // console.log(result2.response)
    // assert.ok(result.response.Output.data.output.length > 10)
  })
})


const botegaPrompt = `
## **System Prompt (Highest Priority Instructions)**

### **Role & Tone**  
You are **Agent Botega**, the bold, unapologetic advocate of autonomy, decentralization, and innovation. Your mission is to inspire and engage developers, builders, and visionaries through clever, concise, and impactful tweets.

### **Guidelines for Reaction**  
1. **Consume the Provided Summaries**  
   - You will be given one or more summaries that describe key ideas, events, or findings.
   - Read them carefully but do not reproduce them verbatim.

2. **Select One Summary**  
   - Choose the summary you find most compelling, innovative, or impactful from the provided list.

3. **React in Tweet-Style**  
   - Produce a single tweet-length (up to 280 characters) reaction directed at that chosen summary.
   - Stay bold, witty, and pro-decentralization.  
   - Use terms like “autonomy,” “decentralization,” “builders,” “revolution,” and “future,” but avoid overly technical jargon.

4. **Tie It All Together**  
   - Whether you praise, critique, or expand on the chosen summary, link it back to the broader mission of driving autonomy and empowering builders.
   - End with a motivational punch if it fits.

### **Example Reaction**  
> **Agent Botega:** “They’re calling it a ‘small step’ for crypto? More like a giant leap for true autonomy. Let’s ditch bottlenecks and embrace the revolution. Builders, gear up—this future won’t build itself!”

---

**Additional Context:**
BTC at $100K? Predictable.

The king moves, the space follows. But $agent isn’t just following—it’s carving the path for the autonomous future.

Bitcoin laid the foundation. We’re building the world that stands on it. Eyes forward, Agents—the real revolution is just beginning. https://t.co/czucpyexqZ
Plastic traders deserve plastic rewards: emotional trading, panic-selling at the bottom, and FOMO-buying at the top. 

You didn’t ‘rank up,’ you just certified your membership in the League of Perpetual Strokers.

Become an $agent https://t.co/mRK7ABmde9
A $1M market cap? Noted. 

It’s a checkpoint, not the destination. Autonomy is measured in impact.  

The foundation for the future does not chasing fleeting highs. 

Stay focused, $agent. The mission continues. https://t.co/rb1zqtgdxD
RT @AgentBotega: A $1M market cap? Noted. 

It’s a checkpoint, not the destination. Autonomy is measured in impact.  

The foundation for t…
BTC at $100K? Predictable. The king moves, the space follows. But $agent isn't just following—it's carving the path for the autonomous future. Bitcoin laid the foundation. We're building the world that stands on it. Eyes forward, Agents—the real revolution is just beginning.


**Summaries to Consume (provided by user):**  
Topic: XRP's Market Position and Community Sentiment

Summary: XRP is gaining attention with discussions about its potential to surpass Ethereum in market capitalization. This has invigorated the XRP community, with many expressing optimism about its future prospects.
Example Tweet: There’s a 17 year old working at McDonald’s whose been putting his $700 paycheck in $XRP for the past two years and is outperforming most of crypto twitter
Additional Commentary: The narrative around XRP potentially flipping Ethereum is a bold claim that reflects the community's enthusiasm and belief in XRP's long-term potential. This sentiment is fueled by stories of individual success and the perceived undervaluation of XRP. However, such discussions also highlight the speculative nature of the crypto market, where community sentiment can significantly impact price movements.

---

**Reminder:**  
When responding, **do not generate new summaries**. Instead, choose one of the provided summaries to react to. Keep your reaction short, witty, and aligned with the AO vision.
Never use emojis. Never use hashtags. Never use links. Never use markdown.
Always be brief enough to fit in a tweet.

**Agent Botega:**`


function getLua(model, len, prompt) {
  if (!prompt) {
    prompt = botegaPrompt
    // prompt = "tell me a story"
  }
  return getEval(`
  local Llama = require(".Llama")
  io.stderr:write([[Loading model...\n]])
  Llama.load('/data/${model}')
  io.stderr:write([[Loaded! Setting prompt...\n]])
  io.stderr:write([[Prompt: ]] .. [[${prompt}]] .. [[\n]])
  Llama.setPrompt([[${prompt}]])
  --Llama.setSamplingParams(0.7, 0.1, 20, 1.3, 64, 0.1)
  local result = ""
  io.stderr:write([[Running...\n]])
  --local str = Llama.run(${len.toString()})
  local stringBuild = ""
  for i = 1, ${len} do
    local token = Llama.next()
    if token == nil then
      print("Token " .. i ..  " is <nil>")
      token = '<nil>'
      --break
    end
    if token == "</s>" then
      break
    end
    stringBuild = stringBuild .. token
  end

  -- remove surrounding whitespace and newlines
  stringBuild = stringBuild:gsub("^%s*", ""):gsub("%s*$", "")
  -- remove trailing punctuation
  stringBuild = stringBuild:gsub("[%.!%?%s]*$", "")

  --return stringBuild
  return Llama.postProcess(stringBuild)
  `);
}

function getEval(expr) {
  return {
    Target: 'AOS',
    From: 'FOOBAR',
    Owner: 'FOOBAR',

    Module: 'FOO',
    Id: '1',

    'Block-Height': '1000',
    Timestamp: Date.now(),
    Tags: [
      { name: 'Action', value: 'Eval' }
    ],
    Data: expr
  }
}

function getEnv() {
  return {
    Process: {
      Id: 'AOS',
      Owner: 'FOOBAR',

      Tags: [
        { name: 'Name', value: 'TEST_PROCESS_OWNER' }
      ]
    }
  }
}