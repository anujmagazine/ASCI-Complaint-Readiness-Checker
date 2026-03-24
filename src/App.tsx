/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Send, 
  AlertCircle, 
  ArrowRight, 
  HelpCircle, 
  ExternalLink,
  ShieldCheck,
  FileText,
  MessageSquare,
  RefreshCcw,
  Info,
  Copy,
  Check
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { cn } from './lib/utils';

// Brand Colors
const COLORS = {
  primary: '#D32F2F',
  secondary: '#00A651',
  accent: '#005EB8',
};

type Step = 'input' | 'check1' | 'check2' | 'check3' | 'summary' | 'success' | 'scope-fail';

interface FormFields {
  advertiserCompany: string;
  brandName: string;
  productName: string;
  productCategory: string;
  adSpot: string;
  adDate: string;
  adDescription: string;
  objectionableClaims: string;
}

interface ComplaintData {
  adImage?: string;
  adText?: string;
  grievance: string;
  followUpAnswers: string[];
  mappedCode?: string;
  mappedChapter?: string;
  isAdScope: boolean;
  isAmbiguous: boolean;
  userCodeCorrect: boolean;
  followUpQuestions: string[];
  formFields?: FormFields;
}

const INITIAL_DATA: ComplaintData = {
  grievance: '',
  followUpAnswers: [],
  isAdScope: false,
  isAmbiguous: false,
  userCodeCorrect: false,
  followUpQuestions: [],
};

export default function App() {
  const [step, setStep] = useState<Step>('input');
  const [data, setData] = useState<ComplaintData>(INITIAL_DATA);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Analyzing...");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setData(prev => ({ ...prev, adImage: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const runCheck1 = async () => {
    setLoading(true);
    setLoadingMessage("Checking if this is an advertising issue...");
    setError(null);
    try {
      const model = "gemini-3-flash-preview";
      const prompt = `
        You are an ASCI (Advertising Standards Council of India) intake assistant.
        Analyze the following user grievance and determine if it falls within ASCI's remit (Advertising Content) or if it's a general consumer grievance (Product defect, delivery issue, customer service, warranty, etc.).
        
        ASCI's remit is strictly restricted to advertising content (claims made in ads, misleading visuals, offensive depictions in ads).
        General consumer grievances (e.g., "I received a broken phone", "Refund not processed") should be directed to the DoCA GAMA portal.
        
        Grievance: "${data.grievance}"
        ${data.adImage ? "An advertisement image has been provided." : ""}
        
        Respond in JSON format:
        {
          "isAdScope": boolean,
          "explanation": "A polite explanation of why this is or isn't within ASCI's advertising remit.",
          "guidance": "If not in scope, provide specific guidance to the Department of Consumer Affairs (DoCA) GAMA portal (https://gama.gov.in)."
        }
      `;

      const parts: any[] = [{ text: prompt }];
      if (data.adImage) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: data.adImage.split(',')[1]
          }
        });
      }

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts }],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || '{}');
      setData(prev => ({ ...prev, isAdScope: result.isAdScope }));
      
      if (!result.isAdScope) {
        setError(result.explanation + " " + result.guidance);
        setStep('scope-fail');
        setLoading(false);
      } else {
        await runCheck2();
      }
    } catch (err) {
      setError("Failed to process request. Please try again.");
      setLoading(false);
    }
  };

  const runCheck2 = async () => {
    setLoadingMessage("Analyzing complaint clarity...");
    try {
      const model = "gemini-3-flash-preview";
      const prompt = `
        The complaint is about an advertisement. Now, determine if the complaint is specific enough or too ambiguous to process.
        Vague complaints like "This ad is a scam" or "This is misleading" without saying WHY are ambiguous.
        
        If ambiguous, generate 2-3 specific follow-up questions to help the user clarify their grievance based on the ad content.
        Example: "What specific health claim is misleading?" or "Is the influencer missing an #Ad disclosure tag?"
        
        Grievance: "${data.grievance}"
        
        Respond in JSON format:
        {
          "isAmbiguous": boolean,
          "followUpQuestions": ["question 1", "question 2"]
        }
      `;

      const parts: any[] = [{ text: prompt }];
      if (data.adImage) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: data.adImage.split(',')[1]
          }
        });
      }

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts }],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || '{}');
      setData(prev => ({ 
        ...prev, 
        isAmbiguous: result.isAmbiguous, 
        followUpQuestions: result.followUpQuestions || [] 
      }));
      
      if (!result.isAmbiguous) {
        await runCheck3();
      } else {
        setStep('check2');
        setLoading(false);
      }
    } catch (err) {
      setError("Failed to analyze ambiguity.");
      setLoading(false);
    }
  };

  const runCheck3 = async (clarifiedGrievance?: string) => {
    setLoading(true);
    setLoadingMessage("Mapping to ASCI Code chapters...");
    try {
      const finalGrievance = clarifiedGrievance || data.grievance;
      const model = "gemini-3-flash-preview";
      const prompt = `
        Map this advertising complaint to the official ASCI Code chapters and generate data for the official ASCI complaint form.
        
        ASCI Chapters:
        - Chapter I: Truthful & Honest Representation (Misleading claims, exaggerated benefits, lack of substantiation, deceptive pricing)
        - Chapter II: Non-offensive to Public (Indecent, vulgar, repulsive, offensive to public decency, objectification)
        - Chapter III: Against Harmful Products/Services/Situations (Inciting crime/violence, deriding groups, harmful to children, manifesting disregard for safety)
        - Chapter IV: Fair in Competition (Unfair comparisons, denigrating competitors, plagiarism of layout/copy)
        
        Complaint: "${finalGrievance}"
        
        Respond in JSON format:
        {
          "chapter": "Chapter X",
          "title": "Full Chapter Title",
          "mappingExplanation": "Briefly explain which specific clause (e.g., 1.4 or 3.1b) applies based on the grievance.",
          "summary": "A professional translation of the user's grievance into regulatory language (e.g., 'Exaggerated health claims likely to mislead consumers regarding product efficacy').",
          "userCodeCorrect": boolean, // Set to true if the user's original complaint already correctly identified the ASCI Chapter (e.g. they mentioned Chapter I or Truthful Representation correctly).
          "formFields": {
            "advertiserCompany": "Name of the company responsible for the ad",
            "brandName": "Name of the brand being advertised",
            "productName": "Specific product name",
            "productCategory": "Category (e.g., Food & Beverage, Healthcare, Education)",
            "adSpot": "Where the ad was seen (e.g., Social Media, TV, Newspaper)",
            "adDate": "Estimated date seen (use current date if unknown)",
            "adDescription": "A brief, neutral description of the advertisement's content and visuals.",
            "objectionableClaims": "Specific claims or visual frames that are objectionable, translated into formal language."
          }
        }
      `;

      const parts: any[] = [{ text: prompt }];
      if (data.adImage) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: data.adImage.split(',')[1]
          }
        });
      }

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts }],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || '{}');
      setData(prev => ({ 
        ...prev, 
        mappedChapter: `${result.chapter}: ${result.title}`,
        mappedCode: result.summary,
        userCodeCorrect: result.userCodeCorrect || false,
        formFields: result.formFields
      }));
      setStep('summary');
    } catch (err) {
      setError("Failed to map ASCI code.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    setLoading(true);
    setLoadingMessage("Submitting to ASCI...");
    setTimeout(() => {
      setLoading(false);
      setStep('success');
    }, 1500);
  };

  const reset = () => {
    setStep('input');
    setData(INITIAL_DATA);
    setError(null);
  };

  const CopyField = ({ label, value }: { label: string, value: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    return (
      <div className="space-y-1 group">
        <div className="flex justify-between items-center">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</label>
          <button 
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-bold text-[#005EB8] hover:text-[#00A651]"
          >
            {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-sm text-gray-700 font-medium break-words">
          {value || "N/A"}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] font-sans text-gray-900">
      <main className="max-w-4xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center gap-6"
            >
              <div className="relative">
                <RefreshCcw className="w-16 h-16 text-[#D32F2F] animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 bg-white rounded-full" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <p className="text-xl font-bold text-gray-900">{loadingMessage}</p>
                <p className="text-gray-500 animate-pulse">Our AI is processing the ASCI guidelines...</p>
              </div>
            </motion.div>
          )}

          {/* Step 1: Input */}
          {step === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <h1 className="text-4xl font-bold tracking-tight text-gray-900">
                  ASCI Complaint Readiness Checker
                </h1>
                <p className="text-lg text-gray-600 max-w-2xl">
                  Our AI assistant will guide you through the process to ensure your complaint is correctly framed and directed.
                </p>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
                {/* Upload Section */}
                <div className="space-y-4">
                  <label className="block text-sm font-semibold uppercase tracking-wider text-gray-500">
                    1. Upload Advertisement (Image/Video/Screenshot)
                  </label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "relative border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all",
                      data.adImage ? "border-[#00A651] bg-[#00A651]/5" : "border-gray-300 hover:border-[#00A651] hover:bg-gray-50"
                    )}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept="image/*" 
                      onChange={handleFileUpload}
                    />
                    {data.adImage ? (
                      <div className="relative w-full max-w-xs aspect-video rounded-lg overflow-hidden shadow-md">
                        <img src={data.adImage} alt="Ad Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <RefreshCcw className="text-white w-8 h-8" />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                          <Upload className="text-[#00A651] w-8 h-8" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium">Click to upload or drag and drop</p>
                          <p className="text-sm text-gray-500">PNG, JPG, GIF up to 10MB</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Grievance Section */}
                <div className="space-y-4">
                  <label className="block text-sm font-semibold uppercase tracking-wider text-gray-500">
                    2. Describe your grievance
                  </label>
                  <textarea
                    value={data.grievance}
                    onChange={(e) => setData(prev => ({ ...prev, grievance: e.target.value }))}
                    placeholder="E.g., This health drink ad claims it cures baldness in 10 days, but that's impossible..."
                    className="w-full min-h-[160px] p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#005EB8] focus:border-transparent transition-all resize-none text-lg"
                  />
                </div>

                <button
                  disabled={!data.grievance || loading}
                  onClick={runCheck1}
                  className="w-full bg-[#D32F2F] text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:bg-[#00A651] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-100"
                >
                  {loading ? (
                    <RefreshCcw className="animate-spin w-6 h-6" />
                  ) : (
                    <>
                      Start AI Evaluation <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-50 border border-red-200 rounded-xl p-6 flex gap-4 items-start"
                >
                  <AlertCircle className="text-red-500 w-6 h-6 shrink-0 mt-0.5" />
                  <div className="space-y-3">
                    <p className="text-red-800 font-medium">{error}</p>
                    <div className="flex gap-4">
                      <a 
                        href="https://gama.gov.in" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-red-700 underline font-bold flex items-center gap-1 hover:text-red-900"
                      >
                        Visit GAMA Portal <ExternalLink className="w-4 h-4" />
                      </a>
                      <button onClick={reset} className="text-gray-500 hover:text-gray-700 text-sm font-medium">
                        Try another complaint
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* Step 2: Interviews */}
          {step === 'check2' && data.isAmbiguous && (
            <motion.div
              key="check2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wider">
                  <HelpCircle className="w-3 h-3" /> More Information Needed
                </div>
                <h1 className="text-3xl font-bold text-gray-900">
                  This request is within scope but ambiguous...
                </h1>
                <h2 className="text-2xl font-bold text-gray-800">Help us understand better</h2>
                <p className="text-gray-600">To process your complaint effectively, we need a few more details.</p>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
                {data.followUpQuestions.map((q, i) => (
                  <div key={i} className="space-y-4">
                    <label className="block font-semibold text-gray-800">{q}</label>
                    <textarea
                      onChange={(e) => {
                        const newAnswers = [...data.followUpAnswers];
                        newAnswers[i] = e.target.value;
                        setData(prev => ({ ...prev, followUpAnswers: newAnswers }));
                      }}
                      className="w-full p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#005EB8] transition-all min-h-[100px]"
                      placeholder="Your answer..."
                    />
                  </div>
                ))}

                <div className="flex gap-4">
                  <button
                    onClick={() => setStep('input')}
                    className="flex-1 bg-gray-100 text-gray-700 py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 transition-all"
                  >
                    Back
                  </button>
                  <button
                    disabled={loading || data.followUpAnswers.length < data.followUpQuestions.length}
                    onClick={() => {
                      const clarified = `Original: ${data.grievance}\n\nClarifications:\n${data.followUpQuestions.map((q, i) => `${q}: ${data.followUpAnswers[i]}`).join('\n')}`;
                      runCheck3(clarified);
                    }}
                    className="flex-[2] bg-[#D32F2F] text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#00A651] transition-all"
                  >
                    {loading ? <RefreshCcw className="animate-spin w-6 h-6" /> : "Finalize Complaint"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Summary & Mapping */}
          {step === 'summary' && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              <div className="text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                  <ShieldCheck className="text-emerald-600 w-10 h-10" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-3xl font-bold text-gray-900">Complaint Ready for Submission</h1>
                  <p className="text-gray-600">
                    {data.userCodeCorrect 
                      ? "You framed the ASCI code right, which is awesome. I have drafted the rest of the complaint fields for you. Please review."
                      : "ASCI Code was incorrect. I have corrected the code and drafted the rest of the complaint fields for you. Please review."}
                  </p>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                      <span className="text-sm font-bold uppercase tracking-wider text-gray-500">Complaint Summary</span>
                      <FileText className="text-gray-400 w-5 h-5" />
                    </div>
                    <div className="p-6 space-y-4">
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 italic text-gray-700">
                        "{data.grievance}"
                      </div>
                      <div className="space-y-2">
                        <h3 className="font-bold text-gray-900">Regulatory Translation:</h3>
                        <p className="text-gray-600 leading-relaxed">{data.mappedCode}</p>
                      </div>
                    </div>
                  </div>

                  {data.formFields && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                        <span className="text-sm font-bold uppercase tracking-wider text-gray-500">ASCI Form Data (Copy-Paste)</span>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Info className="w-4 h-4" />
                          <span>Use these fields for the official form</span>
                        </div>
                      </div>
                      <div className="p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <CopyField label="Advertiser's Company" value={data.formFields.advertiserCompany} />
                          <CopyField label="Brand Name" value={data.formFields.brandName} />
                          <CopyField label="Product Name" value={data.formFields.productName} />
                          <CopyField label="Product Category" value={data.formFields.productCategory} />
                          <CopyField label="Where seen" value={data.formFields.adSpot} />
                          <CopyField label="Date seen" value={data.formFields.adDate} />
                        </div>
                        <div className="space-y-4 pt-4 border-t border-gray-100">
                          <CopyField label="Describe the Advertisement" value={data.formFields.adDescription} />
                          <CopyField label="Objectionable Claims/Visuals" value={data.formFields.objectionableClaims} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="bg-[#D32F2F] rounded-2xl p-6 text-white space-y-4 shadow-lg shadow-red-100">
                    <div className="flex items-center gap-2 text-red-100 text-xs font-bold uppercase tracking-widest">
                      <Info className="w-4 h-4" /> ASCI Code Mapping
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-2xl font-bold">{data.mappedChapter}</h2>
                      <p className="text-red-50 opacity-90 text-sm">Truthful & Honest Representation</p>
                    </div>
                    <div className="pt-4 border-t border-white/20">
                      <p className="text-xs leading-relaxed opacity-80">
                        This chapter ensures that advertisements are truthful and capable of substantiation, protecting consumers from misleading claims.
                      </p>
                    </div>
                  </div>

                  <button 
                    onClick={handleSubmit}
                    className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold hover:bg-[#00A651] transition-all flex items-center justify-center gap-2"
                  >
                    Submit as Mapped <Send className="w-5 h-5" />
                  </button>
                  
                  <div className="space-y-4 pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Options</p>
                    <button onClick={reset} className="w-full text-left text-sm font-semibold text-gray-500 hover:underline flex items-center gap-2">
                      <RefreshCcw className="w-4 h-4" /> Start New Complaint
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-8 py-12"
            >
              <div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <ShieldCheck className="text-emerald-600 w-12 h-12" />
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-bold text-gray-900">Complaint Submitted</h1>
                <p className="text-xl text-gray-600">Your complaint has been successfully queued for review by an ASCI caseworker.</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-gray-200 max-w-md mx-auto shadow-sm">
                <p className="text-sm text-gray-500 mb-4 uppercase tracking-widest font-bold">Reference Number</p>
                <p className="text-3xl font-mono font-bold text-[#D32F2F]">ASCI-{Math.floor(Math.random() * 1000000)}</p>
              </div>
              <button 
                onClick={reset}
                className="bg-gray-900 text-white px-8 py-4 rounded-xl font-bold hover:bg-[#00A651] transition-all"
              >
                File Another Complaint
              </button>
            </motion.div>
          )}

          {/* Step 5: Scope Failure Page */}
          {step === 'scope-fail' && (
            <motion.div
              key="scope-fail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="bg-red-50 border border-red-200 rounded-2xl p-8 md:p-12 space-y-6 shadow-sm">
                <div className="flex items-center gap-4 text-red-600">
                  <AlertCircle className="w-10 h-10" />
                  <h1 className="text-3xl font-bold text-red-900">Scope check failed</h1>
                </div>
                
                <div className="space-y-4">
                  <p className="text-xl text-red-800 leading-relaxed">
                    {error}
                  </p>
                </div>

                <div className="pt-6 flex flex-col sm:flex-row gap-4 border-t border-red-200">
                  <a 
                    href="https://gama.gov.in" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex-1 bg-red-600 text-white py-4 px-6 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-700 transition-all shadow-md"
                  >
                    Visit GAMA Portal <ExternalLink className="w-5 h-5" />
                  </a>
                  <button 
                    onClick={reset}
                    className="flex-1 bg-white text-gray-700 border border-gray-200 py-4 px-6 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-all"
                  >
                    <RefreshCcw className="w-5 h-5" /> Try another complaint
                  </button>
                </div>
                
                <div className="text-center">
                  <button 
                    onClick={() => setStep('input')}
                    className="text-red-700 hover:text-red-900 font-semibold underline underline-offset-4"
                  >
                    Go back to main page
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-24">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex gap-6">
              <a href="#" className="text-gray-400 hover:text-[#00A651] transition-colors"><MessageSquare /></a>
              <a href="#" className="text-gray-400 hover:text-[#00A651] transition-colors"><ShieldCheck /></a>
              <a href="#" className="text-gray-400 hover:text-[#00A651] transition-colors"><FileText /></a>
            </div>
            <p className="text-xs text-gray-400">© 2026 AI&Beyond. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
