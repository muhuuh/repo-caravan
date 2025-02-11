import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import { database } from "../lib/database";
import { supabase, verifyConnection } from "../lib/supabase";
import { FileUpload } from "../components/FileUpload";
import { ExamList } from "../components/ExerciseForge/ExamList";
import { ExamEditor } from "../components/ExerciseForge/ExamEditor";
import { ChatBox } from "../components/ExerciseForge/ChatBox";
import toast from "react-hot-toast";
import type { Exam, Correction } from "../types/database";
import { convertWordToMarkdown } from "../lib/wordToMarkdown";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import {
  convertMarkdownToWord,
  downloadWordDocument,
} from "../lib/markdownToWord";
import { AuroraBackground } from "../components/UI/aurora-background";
import { config } from "../lib/config";

type Mode = "edit" | "correction";

export function ExerciseForge() {
  const { user } = useAuth();
  const examContentCache = useRef<Record<string, string>>({});
  const examListCache = useRef<Exam[]>([]);
  const initialLoadComplete = useRef(false);

  // Exams and currently selected
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);

  // Separate states for exam vs. correction content
  const [examContent, setExamContent] = useState("");
  const [correctionContent, setCorrectionContent] = useState("");

  // The content that is actually displayed/edited in the <ExamEditor> or preview
  const [editableContent, setEditableContent] = useState("");

  // Correction
  const [correction, setCorrection] = useState<Correction | null>(null);

  // Mode, loading states
  const [mode, setMode] = useState<Mode>("edit");
  const [showPreview, setShowPreview] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isWaitingForCorrection, setIsWaitingForCorrection] = useState(false);

  // Chat states
  const [chatMessages, setChatMessages] = useState<
    Array<{ content: string; isUser: boolean; id?: string }>
  >([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [message, setMessage] = useState("");
  const [chatHeight, setChatHeight] = useState(300);
  const startResizeY = useRef<number>(0);
  const startHeight = useRef<number>(0);

  // Add new state for tracking new exam
  const [newExamId, setNewExamId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialLoadComplete.current) {
      loadExams();
      initialLoadComplete.current = true;
    }

    // Set up real-time subscription for corrections
    if (user?.id) {
      const channel = supabase
        .channel("corrections")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "corrections",
            filter: `teacher_id=eq.${user.id}`,
          },
          async (payload) => {
            if (payload.new.teacher_id === user?.id) {
              toast.success("Correction is ready!", {
                duration: 10000,
              });
              setIsWaitingForCorrection(false);
              await loadCorrection("correction");
              setMode("correction");
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user?.id, selectedExam]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("exams")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "exams",
          filter: `teacher_id=eq.${user.id}`,
        },
        async (payload) => {
          if (payload.new.teacher_id === user?.id) {
            const { data: newExam } = await supabase
              .from("exams")
              .select("*")
              .eq("id", payload.new.id)
              .single();

            if (newExam) {
              examContentCache.current[newExam.id] = newExam.content;
              setExams((prev) => [newExam, ...prev]);
              setNewExamId(newExam.id);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const loadExams = async () => {
    try {
      setLoading(true);
      const isConnected = await verifyConnection();
      if (!isConnected) {
        toast.error(
          "Unable to connect to the database. Please check your connection and try again."
        );
        return;
      }

      const { data, error } = await supabase
        .from("exams")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      if (data) {
        setExams(data);
        examListCache.current = data;
      }
    } catch (error) {
      console.error("Error loading exams:", error);
      toast.error(
        "Failed to load exams. Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const updateExamInList = (updatedExam: Exam) => {
    const updatedExams = exams.map((exam) =>
      exam.id === updatedExam.id ? updatedExam : exam
    );
    setExams(updatedExams);
    examListCache.current = updatedExams;
  };

  const addExamToList = (newExam: Exam) => {
    const updatedExams = [newExam, ...exams];
    setExams(updatedExams);
    examListCache.current = updatedExams;
  };

  const loadCorrection = async (currentMode: Mode) => {
    if (!selectedExam) return;

    try {
      setIsLoadingContent(true);
      const corr = await database.corrections.getByExamId(selectedExam.id);
      setCorrection(corr);
      if (corr) {
        setCorrectionContent(corr.content);
        if (currentMode === "correction") {
          setEditableContent(corr.content);
        }
      } else {
        setCorrectionContent("");
        if (currentMode === "correction") {
          setEditableContent("");
        }
      }
    } catch (error) {
      console.error("Error loading correction:", error);
      toast.error("Failed to load correction");
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleExamSelect = async (examId: string | null) => {
    try {
      if (!examId) {
        setSelectedExam(null);
        setExamContent("");
        setCorrectionContent("");
        setCorrection(null);
        setEditableContent("");
        setChatMessages([]);
        setIsCreatingNew(true);
        setMode("edit");
        return;
      }

      if (newExamId === examId) {
        setNewExamId(null);
      }

      setIsLoadingContent(true);
      const fetchedExam = await database.exams.get(examId);

      if (!fetchedExam) {
        toast.error("Failed to load exam. Please try again.");
        return;
      }

      setSelectedExam(fetchedExam);
      setExamContent(fetchedExam.content);
      setEditableContent(fetchedExam.content);
      setCorrectionContent("");
      setCorrection(null);
      setChatMessages([]);
      setMode("edit");
      setIsCreatingNew(false);

      examContentCache.current[examId] = fetchedExam.content;
    } catch (error) {
      console.error("Error loading exam:", error);
      toast.error("Failed to load exam. Please try again.");
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleToggleMode = async (newMode: Mode) => {
    if (mode === "correction" && newMode === "edit") {
      setCorrectionContent(editableContent);
      setEditableContent(examContent);
    } else if (mode === "edit" && newMode === "correction") {
      setExamContent(editableContent);
      if (!correction && selectedExam) {
        await loadCorrection(newMode);
      } else {
        setEditableContent(correctionContent);
      }
    }

    setMode(newMode);
  };

  const handleSave = async () => {
    if (!selectedExam) return;

    try {
      if (mode === "edit") {
        const updatedExam = await database.exams.update(
          selectedExam.id,
          editableContent
        );
        setExamContent(editableContent);
        examContentCache.current[selectedExam.id] = editableContent;
        updateExamInList(updatedExam);
        toast.success("Exam saved successfully");
      } else if (mode === "correction") {
        if (correction) {
          await database.corrections.update(correction.id, editableContent);
          setCorrectionContent(editableContent);
          toast.success("Correction saved successfully");
        } else {
          const newCorr = await database.corrections.create({
            content: editableContent,
            exam_id: selectedExam.id,
          });
          setCorrection(newCorr);
          setCorrectionContent(newCorr.content);
          toast.success("Correction saved successfully");
        }
      }
    } catch (error) {
      console.error("Error saving:", error);
      toast.error(
        `Failed to save ${
          mode === "edit" ? "exam" : "correction"
        }. Please try again.`
      );
    }
  };

  const handleDownload = async () => {
    if (!selectedExam) return;

    try {
      const title =
        mode === "edit"
          ? selectedExam.title
          : `${selectedExam.title} - Correction`;
      const wordBlob = await convertMarkdownToWord(editableContent, title);
      downloadWordDocument(wordBlob, title);
    } catch (error) {
      console.error("Error downloading document:", error);
      toast.error("Failed to download document. Please try again.");
    }
  };

  const handleFilesUploaded = async (files: { file: File }[]) => {
    if (!user?.id) {
      toast.error("Please sign in to upload files");
      return;
    }

    const toastId = toast.loading("Processing files...");

    try {
      for (const { file } of files) {
        const { title, content } = await convertWordToMarkdown(file);
        const exam = await database.exams.create({
          title,
          content,
        });
        examContentCache.current[exam.id] = content;
        addExamToList(exam);
      }

      toast.success("Files processed successfully", { id: toastId });
    } catch (error) {
      console.error("Error processing files:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to process files. Please try again.",
        { id: toastId }
      );
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || (!selectedExam && !isCreatingNew) || !user) return;

    const newMessage = { content: message, isUser: true };
    setChatMessages((prev) => [...prev, newMessage]);
    setMessage("");
    setIsSendingMessage(true);

    setChatMessages((prev) => [
      ...prev,
      { content: "...", isUser: false, id: "typing" },
    ]);

    try {
      const response = await fetch(config.chatWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examId: selectedExam?.id || null,
          teacherId: user.id,
          message: message.trim(),
          mode: isCreatingNew ? "create" : mode,
          correctionId: correction?.id || null,
        }),
      });

      if (!response.ok) throw new Error("Failed to get AI response");

      const data = await response.json();

      setChatMessages((prev) => prev.filter((msg) => msg.id !== "typing"));
      setChatMessages((prev) => [
        ...prev,
        { content: data.output, isUser: false },
      ]);

      if (isCreatingNew && data.examId) {
        const exam = await database.exams.get(data.examId);
        setSelectedExam(exam);
        setExamContent(exam.content);
        setEditableContent(exam.content);
        examContentCache.current[exam.id] = exam.content;
        addExamToList(exam);
        setIsCreatingNew(false);
        toast.success("New exam created!", {
          duration: 10000,
          icon: "📝",
        });
      }

      if (mode === "correction" && data.correctionId) {
        await loadCorrection(mode);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to get AI response. Please try again.");
      setChatMessages((prev) => prev.filter((msg) => msg.id !== "typing"));
    } finally {
      setIsSendingMessage(false);
    }
  };

  const startResize = (e: React.MouseEvent) => {
    startResizeY.current = e.clientY;
    startHeight.current = chatHeight;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startResizeY.current - e.clientY;
      setChatHeight(Math.max(200, Math.min(800, startHeight.current + delta)));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleCreateCorrection = async () => {
    if (!selectedExam || !user) return;

    setIsSendingMessage(true);
    setIsWaitingForCorrection(true);

    try {
      toast.success(
        "Correction request submitted! Processing will begin shortly.",
        {
          duration: 5000,
          icon: "🔄",
        }
      );

      const response = await fetch(config.chatWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examId: selectedExam.id,
          teacherId: user.id,
          mode: "create_correction",
          message:
            "Please create a detailed correction of the exam that is helpful, with step by step explanations of the solution steps.",
        }),
      });

      if (!response.ok) throw new Error("Failed to create correction");
    } catch (error) {
      console.error("Error creating correction:", error);
      toast.error("Failed to create correction");
      setIsWaitingForCorrection(false);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleExamDelete = async (examId: string) => {
    if (!window.confirm("Are you sure you want to delete this exam?")) {
      return;
    }

    try {
      await database.exams.delete(examId);

      delete examContentCache.current[examId];

      const updatedExams = exams.filter((exam) => exam.id !== examId);
      setExams(updatedExams);
      examListCache.current = updatedExams;

      if (selectedExam?.id === examId) {
        setSelectedExam(null);
        setExamContent("");
        setCorrectionContent("");
        setCorrection(null);
        setEditableContent("");
        setChatMessages([]);
        setMode("edit");
      }

      toast.success("Exam deleted successfully");
    } catch (error) {
      console.error("Error deleting exam:", error);
      toast.error("Failed to delete exam. Please try again.");
    }
  };

  const handleTitleChange = async (newTitle: string) => {
    if (!selectedExam) return;
    try {
      await supabase
        .from("exams")
        .update({ title: newTitle })
        .eq("id", selectedExam.id);

      const updatedExam = { ...selectedExam, title: newTitle };
      updateExamInList(updatedExam);
      setSelectedExam(updatedExam);

      toast.success("Title updated successfully");
    } catch (error) {
      console.error("Error updating title:", error);
      toast.error("Failed to update title");
    }
  };

  const handleCorrectionDelete = async (correctionId: string) => {
    if (!window.confirm("Are you sure you want to delete this correction?")) {
      return;
    }

    try {
      await database.corrections.delete(correctionId);

      setCorrection(null);
      setCorrectionContent("");
      setEditableContent("");

      setMode("edit");

      toast.success("Correction deleted successfully");
    } catch (error) {
      console.error("Error deleting correction:", error);
      toast.error("Failed to delete correction. Please try again.");
    }
  };

  return (
    <AuroraBackground>
      <div className="relative w-full min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-4xl font-bold text-blue-900 text-center pt-10 tracking-wide">
              Exercise Forge
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Create personalized exams powered by AI, based on student
              performance data and modern teaching methodologies.
            </p>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-100">
            <div className="p-8">
              <div className="flex justify-between gap-8 pb-8 mb-8 border-b border-gray-200">
                <div className="flex-1 flex items-stretch">
                  <div className="w-full">
                    <FileUpload
                      selectedPupilId=""
                      onUploadComplete={handleFilesUploaded}
                      showPupilSelect={false}
                      acceptedFileTypes={{
                        "application/msword": [".doc"],
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                          [".docx"],
                      }}
                    />
                  </div>
                </div>
                <div className="flex-1 flex items-stretch">
                  <button
                    onClick={() => handleExamSelect(null)}
                    className={`w-full p-6 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] ${
                      isCreatingNew
                        ? "border-indigo-500 bg-gradient-to-br from-indigo-50 to-violet-50"
                        : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50/50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-center gap-3 mb-3">
                        <div className="p-2 bg-indigo-100 rounded-lg">
                          <PencilSquareIcon className="w-6 h-6 text-indigo-600" />
                        </div>
                        <h2 className="text-xl font-semibold text-gray-900">
                          Create New Exam
                        </h2>
                      </div>
                      <p className="text-sm text-gray-600">
                        Start a conversation with AI to create a new exam
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-8">
                <ExamList
                  loading={loading}
                  exams={exams}
                  selectedExam={selectedExam}
                  isCreatingNew={isCreatingNew}
                  onExamSelect={handleExamSelect}
                  onExamDelete={handleExamDelete}
                  onExamDownload={handleDownload}
                  newExamId={newExamId}
                />

                <div className="col-span-2 pl-8 border-l border-gray-100">
                  {selectedExam || isCreatingNew ? (
                    <>
                      {!isCreatingNew && (
                        <ExamEditor
                          selectedExam={selectedExam}
                          isCreatingNew={isCreatingNew}
                          mode={mode}
                          setMode={handleToggleMode}
                          showPreview={showPreview}
                          setShowPreview={setShowPreview}
                          editableContent={editableContent}
                          setEditableContent={setEditableContent}
                          correction={correction}
                          isSendingMessage={isSendingMessage}
                          isLoadingContent={isLoadingContent}
                          isWaitingForCorrection={isWaitingForCorrection}
                          onDownload={handleDownload}
                          onCreateCorrection={handleCreateCorrection}
                          onSave={handleSave}
                          onDelete={() => {
                            if (mode === "correction" && correction) {
                              handleCorrectionDelete(correction.id);
                            } else if (selectedExam) {
                              handleExamDelete(selectedExam.id);
                            }
                          }}
                          title={selectedExam?.title || ""}
                          onTitleChange={handleTitleChange}
                        />
                      )}

                      {isCreatingNew && (
                        <div className="mb-8 bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                          <div className="p-6">
                            <div className="flex items-center gap-4 mb-6">
                              <div className="p-3 bg-gradient-to-br from-indigo-100 to-violet-100 rounded-xl">
                                <PencilSquareIcon className="w-6 h-6 text-indigo-600" />
                              </div>
                              <div>
                                <h2 className="text-xl font-semibold text-gray-900">
                                  Create New Exam
                                </h2>
                                <p className="text-sm text-gray-600 mt-1">
                                  Explain your requirements to the AI assistant
                                </p>
                              </div>
                            </div>

                            <div className="bg-gray-50/80 backdrop-blur-sm rounded-xl p-6 border border-gray-100">
                              <h3 className="text-sm font-medium text-gray-900 mb-4">
                                Include in your request:
                              </h3>
                              <ul className="grid grid-cols-2 gap-4">
                                {[
                                  "Subject matter and topics",
                                  "Difficulty level",
                                  "Types of questions",
                                  "Specific requirements",
                                ].map((item) => (
                                  <li
                                    key={item}
                                    className="flex items-center gap-3"
                                  >
                                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-indigo-400 to-violet-400"></div>
                                    <span className="text-sm text-gray-600">
                                      {item}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}

                      {(mode !== "correction" || correction) && (
                        <ChatBox
                          messages={chatMessages}
                          message={message}
                          setMessage={setMessage}
                          isSendingMessage={isSendingMessage}
                          onSendMessage={handleSendMessage}
                          height={chatHeight}
                          onResize={startResize}
                          isCreatingNew={isCreatingNew}
                          mode={mode}
                        />
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500 space-y-4">
                      <div className="p-4 rounded-full bg-gray-50">
                        <PencilSquareIcon className="w-8 h-8 text-gray-400" />
                      </div>
                      <p>Select an exam to start editing or create a new one</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuroraBackground>
  );
}
