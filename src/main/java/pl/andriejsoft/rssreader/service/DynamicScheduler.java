package pl.andriejsoft.rssreader.service;

import jakarta.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.dto.UserConfigDto;
import pl.andriejsoft.rssreader.entity.AppConfigEntity;
import pl.andriejsoft.rssreader.entity.model.JobParams;
import pl.andriejsoft.rssreader.utils.LogHelper;

@Service
@Slf4j
public class DynamicScheduler {

  @Autowired
  private ThreadPoolTaskScheduler scheduler;

  @Autowired
  private UserConfigService userConfigService;

  @Autowired
  private AppConfigService appConfigService;

  @Autowired
  private RssLoaderService rssLoaderService;

  private final Map<String, ScheduledFuture<?>> scheduledTasks = new ConcurrentHashMap<>();

  @PostConstruct
  public void init() {
    startSchedulersForCurrentUser();
  }

  @Scheduled(fixedDelay = 60 * 60 * 1000, initialDelay = 5 * 60 * 1000)
  public void startCleaning() {
    log.info("Starting cleaning ...");
    AppConfigEntity appConfig = appConfigService.getAppConfigEntities();
    UserConfigDto currentUserConfig = userConfigService.getCurrentUserConfig();

    rssLoaderService.setReadStatusForExpiredItems(currentUserConfig.getId(),
        LocalDateTime.now().minusDays(appConfig.getAppConfigPayload().getDaysForSetRead()));
    rssLoaderService.deleteForExpiredItems(currentUserConfig.getId(),
        LocalDateTime.now().minusDays(appConfig.getAppConfigPayload().getDaysForCleanRssItems()));
  }

  public void startSchedulersForCurrentUser() {
    log.info("Starting scheduler for current user ...");
    UserConfigDto userConfig = userConfigService.getCurrentUserConfig();

    List<JobParams> jobParams = userConfig.getUserConfigPayload().getGroups().stream()
        .flatMap(group -> {
              return group.getRssConfigs().stream().map(rss ->
                  JobParams.builder()
                      .userId(userConfig.getId())
                      .groupUuid(group.getUuid())
                      .rss(rss)
                      .build()
              );
            }
        ).toList();

    if (!jobParams.isEmpty()) {
      update(jobParams);
    }
  }

  private void update(List<JobParams> taskList) {
    for (JobParams task : taskList) {
      LogHelper.info("Start scheduling rss:{}", task);
      String id = task.getRss().getUuid();
      String cron = task.getRss().getRefreshCronExpression();

      cancelIfExists(id);

      if (isValid(cron)) {
        Runnable job = () -> runJob(task);
        CronTrigger trigger = new CronTrigger(cron);
        ScheduledFuture<?> future = scheduler.schedule(job, trigger);
        scheduledTasks.put(id, future);
      }
    }

    // cancel jobs that no longer exist in the database
    scheduledTasks.keySet().removeIf(id -> {
      boolean noLongerInDb = taskList.stream()
          .noneMatch(t -> t.getRss().getUuid().equals(id));
      if (noLongerInDb) {
        cancelIfExists(id);
      }
      return noLongerInDb;
    });
  }

  private ScheduledFuture<?> cancelIfExists(String id) {
    ScheduledFuture<?> existing = scheduledTasks.get(id);
    if (existing != null) {
      existing.cancel(false);
    }
    return existing;
  }

  private void runJob(JobParams task) {
    LogHelper.info("Loading RSS Items for {}", task);
    rssLoaderService.loadRss(task);
  }

  private boolean isValid(String expression) {
    return CronExpression.isValidExpression(expression);
  }
}
